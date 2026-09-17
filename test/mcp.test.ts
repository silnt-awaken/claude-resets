import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createExecutionContext, env } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';
import { __setContentForTests } from '../src/domain/content';
import type { Env } from '../src/env';
import { app } from '../src/index';
import type { ListResponse, StatusResponse } from '../src/routes/api-schemas';
import { mixedScopeEvents, snapshotFor } from './fixtures';
import { json } from './helpers';

afterEach(() => __setContentForTests(null));

function connect(): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL('http://test.local/mcp'), {
    fetch: async (input, init) => app.request(input as string | Request, init as RequestInit, env as unknown as Env, createExecutionContext()),
  });
  const client = new Client({ name: 'test-client', version: '0.0.1' });
  return client.connect(transport).then(() => client);
}

describe('MCP server', () => {
  it('completes initialization and lists three read-only tools', async () => {
    const client = await connect();
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name).sort()).toEqual(['get_claude_reset_status', 'list_claude_reset_sources', 'list_claude_resets']);
    for (const t of tools.tools) {
      expect(t.annotations?.readOnlyHint, t.name).toBe(true);
      expect(t.inputSchema).toBeTruthy();
      expect(t.outputSchema).toBeTruthy();
    }
    await client.close();
  });

  it('invokes each tool and agrees with the public API', async () => {
    const client = await connect();
    const status = await client.callTool({ name: 'get_claude_reset_status', arguments: {} });
    const structured = status.structuredContent as StatusResponse;
    const api = await json<StatusResponse>('/api/v1/status');
    expect(structured.data.latest_reset?.id).toBe(api.body.data.latest_reset?.id);
    expect(structured.data.stats.total).toBe(api.body.data.stats.total);
    expect(structured.meta.content_revision).toBe(api.body.meta.content_revision);

    const list = await client.callTool({ name: 'list_claude_resets', arguments: { limit: 4 } });
    const listBody = list.structuredContent as ListResponse;
    expect(listBody.data).toHaveLength(4);
    expect(listBody.pagination.has_more).toBe(true);
    const apiList = await json<ListResponse>('/api/v1/resets?limit=4');
    expect(listBody.data.map((e) => e.id)).toEqual(apiList.body.data.map((e) => e.id));
    expect(listBody.data[0]!.sources[0]!.url).toMatch(/^https:\/\/x\.com\//);

    const sources = await client.callTool({ name: 'list_claude_reset_sources', arguments: {} });
    expect((sources.structuredContent as { data: unknown[] }).data).toHaveLength(7);
    await client.close();
  });

  it('applies the Max filter exactly like the homepage and API on the mixed-scope fixture', async () => {
    __setContentForTests(snapshotFor(mixedScopeEvents()));
    const client = await connect();
    const status = (await client.callTool({ name: 'get_claude_reset_status', arguments: { audience: 'max' } })).structuredContent as StatusResponse;
    const list = (await client.callTool({ name: 'list_claude_resets', arguments: { audience: 'max' } })).structuredContent as ListResponse;
    const apiStatus = await json<StatusResponse>('/api/v1/status?audience=max');
    const apiList = await json<ListResponse>('/api/v1/resets?audience=max');
    expect(status.data.latest_reset?.id).toBe('max-only');
    expect(status.data.stats.total).toBe(2);
    expect(list.data.map((e) => e.id)).toEqual(['max-only', 'all-users']);
    expect(apiStatus.body.data.stats.total).toBe(status.data.stats.total);
    expect(apiList.body.data.map((e) => e.id)).toEqual(list.data.map((e) => e.id));
    expect(apiStatus.body.meta.content_revision).toBe(status.meta.content_revision);
    await client.close();
  });

  it('rejects invalid tool input and unknown tools', async () => {
    const client = await connect();
    const unknown = await client.callTool({ name: 'publish_reset', arguments: {} }).catch((err: Error) => ({ isError: true, content: [{ type: 'text', text: err.message }] }));
    expect(unknown.isError).toBe(true);
    const bad = await client.callTool({ name: 'list_claude_resets', arguments: { from: 'not-a-date' } });
    expect(bad.isError).toBe(true);
    const badEnum = await client.callTool({ name: 'get_claude_reset_status', arguments: { audience: 'vip' } }).catch((err: Error) => ({ isError: true, content: [{ type: 'text', text: err.message }] }));
    expect(badEnum.isError).toBe(true);
    await client.close();
  });

  it('answers plain HTTP probes with proper errors', async () => {
    const res = await app.request('http://test.local/mcp', { method: 'PUT' }, env as unknown as Env, createExecutionContext());
    expect(res.status).toBe(405);
  });
});
