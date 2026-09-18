// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title RESET — the Claude Resets community token (Robinhood Chain)
/// @notice Fixed supply, no mint function. Supply can only go down.
///
/// Mechanics (all on-chain, all public):
///  - 1,000,000,000 RESET minted once to the deployer, who then distributes per docs/goal-and-token.md.
///  - A 1% fee on transfers between non-exempt accounts: 60% of the fee is burned, 40% goes to the
///    goal pool (`poolAddress`) to fund the next community goal. Liquidity pools, the treasury and
///    the pool itself are fee-exempt so trading and payouts are not taxed twice.
///  - `burnForReset(eventId, amount)`: the owner burns from the burn reserve every time a real
///    Claude reset is published, emitting the event id so the burn can be matched to the announcement.
///  - `burnForRound(roundId, amount)`: the same for each completed goal round.
///  - Anyone can `burn` their own tokens.
///  - `renounceOwnership()` freezes exemptions and the fee configuration forever.
contract ResetToken {
    string public constant name = "Reset";
    string public constant symbol = "RESET";
    uint8 public constant decimals = 18;
    uint256 public constant INITIAL_SUPPLY = 1_000_000_000e18;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    address public owner;
    address public poolAddress;
    uint16 public feeBps = 100; // 1.00%
    uint16 public constant MAX_FEE_BPS = 200; // fee can be lowered or removed, never raised above 2%
    uint16 public burnShareBps = 6000; // 60% of the fee is burned, remainder goes to the pool
    mapping(address => bool) public feeExempt;

    uint256 public totalBurned;
    uint256 public totalPoolFees;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event Burn(address indexed from, uint256 amount, string reason);
    event ResetBurn(string eventId, uint256 amount);
    event RoundBurn(uint256 indexed roundId, uint256 amount);
    event FeeConfig(uint16 feeBps, uint16 burnShareBps, address poolAddress);
    event FeeExempt(address indexed account, bool exempt);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    constructor(address initialPool) {
        owner = msg.sender;
        poolAddress = initialPool;
        feeExempt[msg.sender] = true;
        feeExempt[initialPool] = true;
        totalSupply = INITIAL_SUPPLY;
        balanceOf[msg.sender] = INITIAL_SUPPLY;
        emit Transfer(address(0), msg.sender, INITIAL_SUPPLY);
        emit FeeConfig(feeBps, burnShareBps, initialPool);
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

    function burn(uint256 amount) external {
        _burn(msg.sender, amount, "holder");
    }

    /// @notice Burn from the owner's reserve when a verified Claude reset is published.
    function burnForReset(string calldata eventId, uint256 amount) external onlyOwner {
        _burn(msg.sender, amount, "reset");
        emit ResetBurn(eventId, amount);
    }

    /// @notice Burn from the owner's reserve when a community goal round pays out.
    function burnForRound(uint256 roundId, uint256 amount) external onlyOwner {
        _burn(msg.sender, amount, "round");
        emit RoundBurn(roundId, amount);
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

    /// @notice Permanently give up control: fees, exemptions and pool address are frozen.
    function renounceOwnership() external onlyOwner {
        emit OwnershipTransferred(owner, address(0));
        owner = address(0);
    }
}
