/**
 * Subgraph queries — all reads go through the live Studio endpoint.
 * Schema matches veri/subgraph/schema.graphql.
 *
 * Agent IDs in the subgraph are labelHash bytes (hex), so we compute
 * keccak256(utf8(label)) to look up a single agent by label.
 */
import { GraphQLClient, gql } from "graphql-request";
import { ethers } from "ethers";
import { config } from "./config.js";

const client = config.subgraphUrl
  ? new GraphQLClient(config.subgraphUrl)
  : null;

// Convert "scanner.veri.eth" or "scanner" → bytes32 hex labelHash
function labelHashId(subnameOrLabel) {
  const label = subnameOrLabel.split(".")[0];
  return ethers.keccak256(ethers.toUtf8Bytes(label));
}

// ─────────────────────────────────────────────────────────────────────────────
// Queries
// ─────────────────────────────────────────────────────────────────────────────

const AGENT_FIELDS = gql`
  fragment AgentFields on Agent {
    id
    label
    name
    agentAddress
    currentTokenId
    expiry
    active
    context
    mcpEndpoint
    issuedAt
    issuedTx
    human { id agentCount firstSeenAt }
    capabilities(where: { granted: true }) {
      capabilityId
      name
      roleBitmap
      grantedAt
      revokedAt
    }
  }
`;

const LIST_AGENTS = gql`
  ${AGENT_FIELDS}
  query ListAgents($first: Int!) {
    agents(
      first: $first
      where: { active: true }
      orderBy: issuedAt
      orderDirection: desc
    ) { ...AgentFields }
  }
`;

const GET_AGENT = gql`
  ${AGENT_FIELDS}
  query GetAgent($id: Bytes!) {
    agent(id: $id) { ...AgentFields }
  }
`;

const GET_HISTORY = gql`
  query AgentHistory($id: Bytes!, $first: Int!) {
    capabilityEvents(
      where: { agent: $id }
      orderBy: timestamp
      orderDirection: desc
      first: $first
    ) {
      id
      action
      reason
      capabilityId
      blockNumber
      timestamp
      txHash
    }
  }
`;

const GET_FEED = gql`
  query Feed($first: Int!) {
    capabilityEvents(
      first: $first
      orderBy: timestamp
      orderDirection: desc
    ) {
      id
      action
      reason
      timestamp
      txHash
      capabilityId
      agent { name label }
    }
  }
`;

const GET_PROTOCOL = gql`
  query Protocol {
    protocol(id: "veri") {
      totalHumans
      totalAgents
      activeAgents
      totalRevocations
    }
  }
`;

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchAgents(limit = 100) {
  if (!client) return [];
  const data = await client.request(LIST_AGENTS, { first: limit });
  return data.agents ?? [];
}

export async function fetchAgent(subnameOrLabel) {
  if (!client) return null;
  const id = labelHashId(subnameOrLabel);
  const data = await client.request(GET_AGENT, { id });
  return data.agent ?? null;
}

export async function fetchAgentHistory(subnameOrLabel, limit = 50) {
  if (!client) return [];
  const id = labelHashId(subnameOrLabel);
  const data = await client.request(GET_HISTORY, { id, first: limit });
  return data.capabilityEvents ?? [];
}

export async function fetchFeed(limit = 20) {
  if (!client) return [];
  const data = await client.request(GET_FEED, { first: limit });
  return data.capabilityEvents ?? [];
}

export async function fetchProtocolStats() {
  if (!client) return null;
  const data = await client.request(GET_PROTOCOL);
  return data.protocol ?? null;
}
