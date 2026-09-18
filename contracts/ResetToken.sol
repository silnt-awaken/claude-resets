// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title RESET — the Claude Resets community token (Robinhood Chain)
/// @notice Fixed supply, no mint function. Supply can only go down.
///
/// Mechanics (all on-chain, all public):
///  - 1,000,000,000 RESET minted once: the burn reserve (15%) is held by this contract itself, the rest
///    goes to the deployer, who distributes it per docs/goal-and-token.md.
///  - A 1% fee on transfers between non-exempt accounts: 60% of the fee is burned, 40% goes to the
///    goal pool (`poolAddress`) to fund the next community goal. Liquidity pools, the treasury and
///    the pool itself are fee-exempt so trading and payouts are not taxed twice.
///  - `burnForReset(eventId)`: burns `resetBurnAmount` from the reserve every time a real Claude reset
///    is published, emitting the event id so the burn can be matched to the announcement. Each event
///    id burns once. Called automatically by the site's burner wallet (`burner`), or by the owner.
///  - `burnForRound(roundId)`: the same for each completed goal round.
///  - The burner can do nothing except trigger these fixed, rate-limited, once-per-id burns from the
///    reserve. It cannot move tokens. A leaked burner key can at worst burn the reserve early.
///  - Anyone can `burn` their own tokens. Anyone can `fundReserve` to top the reserve up.
///  - `renounceOwnership()` freezes fee configuration, exemptions, burn amounts and the burner forever.
contract ResetToken {
    string public constant name = "Reset";
    string public constant symbol = "RESET";
    uint8 public constant decimals = 18;
    uint256 public constant INITIAL_SUPPLY = 1_000_000_000e18;
    uint256 public constant INITIAL_RESERVE = 150_000_000e18; // 15% held by the contract for scheduled burns

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    address public owner;
    address public burner; // the site's automation wallet; may only trigger reserve burns
    address public poolAddress;
    uint16 public feeBps = 100; // 1.00%
    uint16 public constant MAX_FEE_BPS = 200; // fee can be lowered or removed, never raised above 2%
    uint16 public burnShareBps = 6000; // 60% of the fee is burned, remainder goes to the pool
    mapping(address => bool) public feeExempt;

    uint256 public resetBurnAmount = 2_500_000e18; // 0.25% of initial supply per published reset
    uint256 public roundBurnAmount = 5_000_000e18; // 0.5% per completed goal round
    uint256 public minBurnInterval = 1 hours; // rate limit for the burner (the owner is not limited)
    uint256 public lastBurnerBurnAt;
    mapping(bytes32 => bool) public resetBurned; // keccak256(eventId) => already burned
    mapping(uint256 => bool) public roundBurned;

    uint256 public totalBurned;
    uint256 public totalPoolFees;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event Burn(address indexed from, uint256 amount, string reason);
    event ResetBurn(string eventId, uint256 amount);
    event RoundBurn(uint256 indexed roundId, uint256 amount);
    event ReserveFunded(address indexed from, uint256 amount);
    event FeeConfig(uint16 feeBps, uint16 burnShareBps, address poolAddress);
    event FeeExempt(address indexed account, bool exempt);
    event BurnConfig(uint256 resetBurnAmount, uint256 roundBurnAmount, uint256 minBurnInterval);
    event BurnerChanged(address indexed previousBurner, address indexed newBurner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    modifier onlyBurnerOrOwner() {
        require(msg.sender == owner || (msg.sender == burner && burner != address(0)), "not burner");
        _;
    }

    constructor(address initialPool, address initialBurner) {
        require(initialPool != address(0), "pool zero");
        owner = msg.sender;
        poolAddress = initialPool;
        burner = initialBurner;
        feeExempt[msg.sender] = true;
        feeExempt[initialPool] = true;
        feeExempt[address(this)] = true;
        totalSupply = INITIAL_SUPPLY;
        balanceOf[address(this)] = INITIAL_RESERVE;
        balanceOf[msg.sender] = INITIAL_SUPPLY - INITIAL_RESERVE;
        emit Transfer(address(0), address(this), INITIAL_RESERVE);
        emit Transfer(address(0), msg.sender, INITIAL_SUPPLY - INITIAL_RESERVE);
        emit FeeConfig(feeBps, burnShareBps, initialPool);
        emit BurnConfig(resetBurnAmount, roundBurnAmount, minBurnInterval);
        emit BurnerChanged(address(0), initialBurner);
    }

    // ---------- ERC-20 ----------

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            require(allowed >= amount, "allowance");
            allowance[from][msg.sender] = allowed - amount;
        }
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(to != address(0), "to zero");
        require(balanceOf[from] >= amount, "balance");
        uint256 fee = 0;
        if (feeBps > 0 && !feeExempt[from] && !feeExempt[to]) {
            fee = (amount * feeBps) / 10_000;
        }
        balanceOf[from] -= amount;
        uint256 received = amount - fee;
        balanceOf[to] += received;
        emit Transfer(from, to, received);
        if (fee > 0) {
            uint256 toBurn = (fee * burnShareBps) / 10_000;
            uint256 toPool = fee - toBurn;
            if (toBurn > 0) {
                totalSupply -= toBurn;
                totalBurned += toBurn;
                emit Transfer(from, address(0), toBurn);
                emit Burn(from, toBurn, "transfer-fee");
            }
            if (toPool > 0) {
                balanceOf[poolAddress] += toPool;
                totalPoolFees += toPool;
                emit Transfer(from, poolAddress, toPool);
            }
        }
    }

    // ---------- burns ----------

    /// @notice Tokens held by the contract, waiting to be burned on schedule.
    function burnReserve() external view returns (uint256) {
        return balanceOf[address(this)];
    }

    function burn(uint256 amount) external {
        _burn(msg.sender, amount, "holder");
    }

    /// @notice Move your own tokens into the burn reserve (fee-free).
    function fundReserve(uint256 amount) external {
        require(balanceOf[msg.sender] >= amount, "balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[address(this)] += amount;
        emit Transfer(msg.sender, address(this), amount);
        emit ReserveFunded(msg.sender, amount);
    }

    /// @notice Burn `resetBurnAmount` from the reserve for a published Claude reset. Once per event id.
    function burnForReset(string calldata eventId) external onlyBurnerOrOwner {
        bytes32 key = keccak256(bytes(eventId));
        require(!resetBurned[key], "already burned");
        resetBurned[key] = true;
        uint256 amount = _reserveBurn(resetBurnAmount, "reset");
        emit ResetBurn(eventId, amount);
    }

    /// @notice Burn `roundBurnAmount` from the reserve when a community goal round pays out. Once per round.
    function burnForRound(uint256 roundId) external onlyBurnerOrOwner {
        require(!roundBurned[roundId], "already burned");
        roundBurned[roundId] = true;
        uint256 amount = _reserveBurn(roundBurnAmount, "round");
        emit RoundBurn(roundId, amount);
    }

    function _reserveBurn(uint256 wanted, string memory reason) internal returns (uint256 amount) {
        if (msg.sender != owner) {
            require(block.timestamp >= lastBurnerBurnAt + minBurnInterval, "rate limit");
            lastBurnerBurnAt = block.timestamp;
        }
        uint256 reserve = balanceOf[address(this)];
        amount = wanted > reserve ? reserve : wanted;
        require(amount > 0, "reserve empty");
        _burn(address(this), amount, reason);
    }

    function _burn(address from, uint256 amount, string memory reason) internal {
        require(balanceOf[from] >= amount, "balance");
        balanceOf[from] -= amount;
        totalSupply -= amount;
        totalBurned += amount;
        emit Transfer(from, address(0), amount);
        emit Burn(from, amount, reason);
    }

    // ---------- configuration (owner only, until ownership is renounced) ----------

    function setBurner(address newBurner) external onlyOwner {
        emit BurnerChanged(burner, newBurner);
        burner = newBurner;
    }

    /// @dev Burn sizes can be changed while the owner exists; renouncing freezes them.
    function setBurnConfig(uint256 newResetBurnAmount, uint256 newRoundBurnAmount, uint256 newMinBurnInterval) external onlyOwner {
        require(newMinBurnInterval <= 7 days, "interval");
        resetBurnAmount = newResetBurnAmount;
        roundBurnAmount = newRoundBurnAmount;
        minBurnInterval = newMinBurnInterval;
        emit BurnConfig(newResetBurnAmount, newRoundBurnAmount, newMinBurnInterval);
    }

    function setFeeExempt(address account, bool exempt) external onlyOwner {
        feeExempt[account] = exempt;
        emit FeeExempt(account, exempt);
    }

    /// @dev The fee can only be lowered or kept; the cap is fixed at deployment.
    function setFee(uint16 newFeeBps, uint16 newBurnShareBps) external onlyOwner {
        require(newFeeBps <= MAX_FEE_BPS, "fee cap");
        require(newBurnShareBps <= 10_000, "share");
        feeBps = newFeeBps;
        burnShareBps = newBurnShareBps;
        emit FeeConfig(feeBps, burnShareBps, poolAddress);
    }

    function setPoolAddress(address newPool) external onlyOwner {
        require(newPool != address(0), "pool zero");
        poolAddress = newPool;
        feeExempt[newPool] = true;
        emit FeeConfig(feeBps, burnShareBps, newPool);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "owner zero");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    /// @notice Permanently give up control: fees, exemptions, burn sizes, pool address and burner are frozen.
    function renounceOwnership() external onlyOwner {
        emit OwnershipTransferred(owner, address(0));
        owner = address(0);
    }
}
