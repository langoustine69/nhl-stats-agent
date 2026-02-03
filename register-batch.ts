import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet } from 'viem/chains';

const REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';
const PRIVATE_KEY = '0x5bb62a57934bafa8c539d1eca49be68bbf367929a7d19d416f18c207f71a3ab3';
const RPC_URL = 'https://eth.llamarpc.com';

const agents = [
  'ai-model-registry',
  'asteroid-watch',
  'books-agent',
  'currency-exchange',
  'earthquake-intel',
  'econ-indicators',
  'f1-racing-agent',
  'hn-intel',
  'indycar-data',
  'ip-intel',
  'ncaa-hoops',
  'social-signals',
  'space-weather-agent',
  'sports-data-agent',
  'sports-scores-agent',
  'tech-pulse',
  'tennis-data',
  'tide-tracker',
  'treasury-data-agent'
];

const account = privateKeyToAccount(PRIVATE_KEY);
const walletClient = createWalletClient({ account, chain: mainnet, transport: http(RPC_URL) });
const publicClient = createPublicClient({ chain: mainnet, transport: http(RPC_URL) });

const abi = [{ name: 'register', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'agentURI', type: 'string' }], outputs: [{ name: 'agentId', type: 'uint256' }] }] as const;

async function registerAgent(name: string) {
  const domain = `${name}-production.up.railway.app`;
  const uri = `https://${domain}/.well-known/agent-metadata.json`;
  
  try {
    const hash = await walletClient.writeContract({
      address: REGISTRY,
      abi,
      functionName: 'register',
      args: [uri],
    });
    console.log(`✅ ${name}: https://etherscan.io/tx/${hash}`);
    await new Promise(r => setTimeout(r, 1000));
    return { name, hash, success: true };
  } catch (e: any) {
    console.log(`❌ ${name}: ${e.shortMessage || e.message?.slice(0, 80) || e}`);
    return { name, error: e.message, success: false };
  }
}

async function main() {
  console.log(`Registering ${agents.length} agents on ERC-8004...\n`);
  console.log(`Wallet: ${account.address}`);
  console.log(`Registry: ${REGISTRY}\n`);
  
  const results = [];
  for (const agent of agents) {
    const result = await registerAgent(agent);
    results.push(result);
    await new Promise(r => setTimeout(r, 2000));
  }
  
  console.log('\n--- Summary ---');
  const successes = results.filter(r => r.success);
  console.log(`Success: ${successes.length}/${results.length}`);
  if (successes.length > 0) {
    console.log('\nTx hashes:');
    successes.forEach(r => console.log(`  ${r.name}: ${r.hash}`));
  }
}

main().catch(console.error);
