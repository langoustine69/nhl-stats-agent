/**
 * Register NHL Stats Agent on ERC-8004 Ethereum Mainnet
 * 
 * Run once to register: bun run register
 * 
 * Required env vars:
 *   PRIVATE_KEY - Wallet private key for signing
 *   AGENT_DOMAIN - Domain for the agent
 *   RPC_URL - Ethereum mainnet RPC
 *   CHAIN_ID - 1 for Ethereum mainnet
 */

import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet } from 'viem/chains';

// ERC-8004 Identity Registry on Ethereum Mainnet
const IDENTITY_REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';

// Minimal ABI for register function
const REGISTRY_ABI = [
  {
    name: 'register',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'agentURI', type: 'string' }],
    outputs: [{ name: 'agentId', type: 'uint256' }],
  },
  {
    name: 'ownerOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

async function main() {
  console.log('🏒 Registering NHL Stats Agent on ERC-8004 Ethereum Mainnet...\n');

  const domain = process.env.AGENT_DOMAIN;
  if (!domain) {
    console.error('❌ AGENT_DOMAIN environment variable required');
    process.exit(1);
  }

  const privateKey = process.env.PRIVATE_KEY as `0x${string}`;
  if (!privateKey) {
    console.error('❌ PRIVATE_KEY environment variable required');
    process.exit(1);
  }

  const rpcUrl = process.env.RPC_URL || 'https://eth.llamarpc.com';

  try {
    // Create clients
    const account = privateKeyToAccount(privateKey);
    const publicClient = createPublicClient({
      chain: mainnet,
      transport: http(rpcUrl),
    });
    const walletClient = createWalletClient({
      account,
      chain: mainnet,
      transport: http(rpcUrl),
    });

    console.log('📍 Wallet address:', account.address);
    console.log('📍 Domain:', domain);
    console.log('📍 Registry:', IDENTITY_REGISTRY);
    console.log('📍 Chain: Ethereum Mainnet (1)\n');

    // Check ETH balance
    const balance = await publicClient.getBalance({ address: account.address });
    console.log('💰 ETH Balance:', Number(balance) / 1e18, 'ETH');
    
    if (balance === 0n) {
      console.error('❌ No ETH for gas fees. Please fund the wallet.');
      process.exit(1);
    }

    // Check if already registered (has any agent tokens)
    const tokenBalance = await publicClient.readContract({
      address: IDENTITY_REGISTRY,
      abi: REGISTRY_ABI,
      functionName: 'balanceOf',
      args: [account.address],
    });

    if (tokenBalance > 0n) {
      console.log('ℹ️  Wallet already has', tokenBalance.toString(), 'agent token(s)');
    }

    // Construct agent URI
    const agentURI = `https://${domain}/.well-known/agent-metadata.json`;
    console.log('\n🔗 Agent URI:', agentURI);

    // Register the agent
    console.log('\n📝 Sending registration transaction...');
    
    const hash = await walletClient.writeContract({
      address: IDENTITY_REGISTRY,
      abi: REGISTRY_ABI,
      functionName: 'register',
      args: [agentURI],
    });

    console.log('✅ Transaction sent:', hash);
    console.log('⏳ Waiting for confirmation...');

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    
    console.log('\n✅ Registration confirmed!');
    console.log('   Block:', receipt.blockNumber);
    console.log('   Gas used:', receipt.gasUsed.toString());

    // Generate metadata to host
    const metadata = {
      name: 'NHL Stats Agent',
      description: 'Live NHL hockey stats, standings, and player data via x402 micropayments',
      version: '1.0.0',
      owner: account.address,
      chain: 'eip155:1',
      registeredAt: new Date().toISOString(),
      capabilities: [
        { name: 'overview', description: 'Free NHL overview - top teams, scorers, games', price: 0 },
        { name: 'standings', description: 'Full NHL standings by conference/division', price: 0.001 },
        { name: 'player', description: 'Detailed player stats by ID', price: 0.002 },
        { name: 'leaders', description: 'NHL stats leaders', price: 0.002 },
        { name: 'team', description: 'Team details with roster', price: 0.003 },
        { name: 'report', description: 'Comprehensive NHL report', price: 0.005 },
      ],
      x402: {
        receiverAddress: account.address,
        network: 'base',
        facilitator: 'https://facilitator.daydreams.systems',
      },
    };

    console.log('\n📄 Host this metadata at:');
    console.log(`   ${agentURI}\n`);
    console.log(JSON.stringify(metadata, null, 2));

    console.log('\n🎉 Agent successfully registered on ERC-8004!');
    console.log('   View on Etherscan: https://etherscan.io/tx/' + hash);

  } catch (error: any) {
    console.error('\n❌ Registration failed:', error.message || error);
    if (error.shortMessage) {
      console.error('   Details:', error.shortMessage);
    }
    process.exit(1);
  }
}

main();
