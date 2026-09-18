// Minimal ABI of contracts/ResetToken.sol used by the Worker (burn triggers and read-only checks).
export const RESET_TOKEN_ABI = [
  { type: 'function', name: 'burnForReset', stateMutability: 'nonpayable', inputs: [{ name: 'eventId', type: 'string' }], outputs: [] },
  { type: 'function', name: 'burnForRound', stateMutability: 'nonpayable', inputs: [{ name: 'roundId', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'resetBurned', stateMutability: 'view', inputs: [{ name: '', type: 'bytes32' }], outputs: [{ name: '', type: 'bool' }] },
  { type: 'function', name: 'roundBurned', stateMutability: 'view', inputs: [{ name: '', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }] },
  { type: 'function', name: 'burner', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
  { type: 'function', name: 'burnReserve', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'resetBurnAmount', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'roundBurnAmount', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'setBurner', stateMutability: 'nonpayable', inputs: [{ name: 'newBurner', type: 'address' }], outputs: [] },
  { type: 'event', name: 'ResetBurn', inputs: [{ name: 'eventId', type: 'string', indexed: false }, { name: 'amount', type: 'uint256', indexed: false }] },
  { type: 'event', name: 'RoundBurn', inputs: [{ name: 'roundId', type: 'uint256', indexed: true }, { name: 'amount', type: 'uint256', indexed: false }] },
] as const;
