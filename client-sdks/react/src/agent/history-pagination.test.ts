// @vitest-environment jsdom
import type { MastraDBMessage } from '@mastra/core/agent/message-list';
import type { ChunkType } from '@mastra/core/stream';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MastraClientProvider } from '../mastra-client-context';
import { useChat } from './hooks';

const subscriptions: ReadableStreamDefaultController<Uint8Array>[] = [];
const fetchMock = vi.fn<typeof fetch>();
const scope = { agentId: 'agent-1', resourceId: 'resource-1', threadId: 'thread-1' };
const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(MastraClientProvider, { baseUrl: 'http://localhost:4111', customFetch: fetchMock, children });

const history = (hasMore: boolean, messages: MastraDBMessage[] = []): ChunkType => ({
  type: 'thread-history',
  runId: '',
  from: 'AGENT',
  payload: { messages, hasMore },
});
const push = (chunk: ChunkType, index = 0) => {
  const subscription = subscriptions[index];
  if (!subscription) throw new Error('Subscription not established');
  subscription.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\n\n`));
};

beforeEach(() => {
  subscriptions.length = 0;
  fetchMock.mockReset();
  fetchMock.mockImplementation(async url => {
    if (String(url).endsWith('/threads/subscribe')) {
      const body = new ReadableStream<Uint8Array>({ start: controller => subscriptions.push(controller) });
      return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
    }
    if (String(url).endsWith('/send-message')) return Response.json({ accepted: true, runId: 'run-1' });
    throw new Error(`Unexpected request: ${url}`);
  });
});
afterEach(cleanup);

describe('useChat initial history pagination', () => {
  it.each([true, false])('exposes hasMore=%s even for an empty history page', async hasMore => {
    const { result } = renderHook(() => useChat({ ...scope, enableThreadSignals: true, withInitialHistory: true }), {
      wrapper,
    });
    expect(result.current.initialHistoryPagination).toBeUndefined();
    await waitFor(() => expect(subscriptions).toHaveLength(1));
    await act(async () => push(history(hasMore)));

    await waitFor(() => expect(result.current.initialHistoryPagination).toEqual({ hasMore }));
    expect(result.current.messages).toEqual([]);
  });

  it('keeps pagination unavailable when initial history is disabled', async () => {
    const { result } = renderHook(() => useChat({ ...scope, enableThreadSignals: true }), { wrapper });
    await waitFor(() => expect(subscriptions).toHaveLength(1));
    await act(async () => push(history(true)));

    expect(result.current.initialHistoryPagination).toBeUndefined();
  });

  it.each(['agentId', 'resourceId', 'threadId'] as const)('invalidates history when %s changes', async field => {
    const { result, rerender } = renderHook(
      props => useChat({ ...props, enableThreadSignals: true, withInitialHistory: true }),
      { wrapper, initialProps: scope },
    );
    await waitFor(() => expect(subscriptions).toHaveLength(1));
    await act(async () => push(history(true)));
    await waitFor(() => expect(result.current.initialHistoryPagination).toEqual({ hasMore: true }));

    rerender({ ...scope, [field]: 'scope-2' });
    expect(result.current.initialHistoryPagination).toBeUndefined();
    await waitFor(() => expect(subscriptions).toHaveLength(2));
    await act(async () => push(history(false), 1));
    await waitFor(() => expect(result.current.initialHistoryPagination).toEqual({ hasMore: false }));
  });

  it('uses the default resource ID when resourceId is omitted', async () => {
    const { result } = renderHook(
      () =>
        useChat({
          agentId: scope.agentId,
          threadId: scope.threadId,
          enableThreadSignals: true,
          withInitialHistory: true,
        }),
      { wrapper },
    );
    await waitFor(() => expect(subscriptions).toHaveLength(1));
    await act(async () => push(history(true)));

    await waitFor(() => expect(result.current.initialHistoryPagination).toEqual({ hasMore: true }));
  });

  it('requests fresh history when initial history is enabled or re-enabled', async () => {
    const { result, rerender } = renderHook(
      ({ withInitialHistory }: { withInitialHistory: boolean }) =>
        useChat({ ...scope, enableThreadSignals: true, withInitialHistory }),
      { wrapper, initialProps: { withInitialHistory: false } },
    );
    await waitFor(() => expect(subscriptions).toHaveLength(1));
    rerender({ withInitialHistory: true });
    expect(result.current.initialHistoryPagination).toBeUndefined();
    await waitFor(() => expect(subscriptions).toHaveLength(2));
    await act(async () => push(history(true), 1));
    await waitFor(() => expect(result.current.initialHistoryPagination).toEqual({ hasMore: true }));

    rerender({ withInitialHistory: false });
    expect(result.current.initialHistoryPagination).toBeUndefined();
    await waitFor(() => expect(subscriptions).toHaveLength(3));
    rerender({ withInitialHistory: true });
    expect(result.current.initialHistoryPagination).toBeUndefined();
    await waitFor(() => expect(subscriptions).toHaveLength(4));
    await act(async () => push(history(false), 3));
    await waitFor(() => expect(result.current.initialHistoryPagination).toEqual({ hasMore: false }));
  });

  it('waits for a fresh page when the requested history page size changes', async () => {
    const { result, rerender } = renderHook(
      ({ perPage }) => useChat({ ...scope, enableThreadSignals: true, withInitialHistory: { perPage } }),
      { wrapper, initialProps: { perPage: 10 } },
    );
    await waitFor(() => expect(subscriptions).toHaveLength(1));
    await act(async () => push(history(true)));
    await waitFor(() => expect(result.current.initialHistoryPagination).toEqual({ hasMore: true }));
    rerender({ perPage: 20 });
    expect(result.current.initialHistoryPagination).toBeUndefined();
    await waitFor(() => expect(subscriptions).toHaveLength(2));
    await act(async () => push(history(false), 1));
    await waitFor(() => expect(result.current.initialHistoryPagination).toEqual({ hasMore: false }));
  });

  it('waits for fresh history after the same thread resubscribes', async () => {
    const { result } = renderHook(() => useChat({ ...scope, enableThreadSignals: true, withInitialHistory: true }), {
      wrapper,
    });
    await waitFor(() => expect(subscriptions).toHaveLength(1));
    await act(async () => push(history(true)));
    await waitFor(() => expect(result.current.initialHistoryPagination).toEqual({ hasMore: true }));
    await act(async () => subscriptions[0]?.close());
    await waitFor(() => expect(result.current.initialHistoryPagination).toBeUndefined());

    await act(async () => result.current.sendMessage({ message: 'reconnect', threadId: scope.threadId }));
    await waitFor(() => expect(subscriptions).toHaveLength(2));
    expect(result.current.initialHistoryPagination).toBeUndefined();
    await act(async () => push(history(false), 1));
    await waitFor(() => expect(result.current.initialHistoryPagination).toEqual({ hasMore: false }));
  });

  it('preserves pagination through live output and manual message updates', async () => {
    const { result } = renderHook(() => useChat({ ...scope, enableThreadSignals: true, withInitialHistory: true }), {
      wrapper,
    });
    await waitFor(() => expect(subscriptions).toHaveLength(1));
    await act(async () => push(history(true)));
    await waitFor(() => expect(result.current.initialHistoryPagination).toEqual({ hasMore: true }));
    await act(async () => {
      push({ type: 'start', runId: 'run-1', from: 'AGENT', payload: { messageId: 'message-1' } });
      push({ type: 'text-start', runId: 'run-1', from: 'AGENT', payload: { id: 'text-1' } });
      push({ type: 'text-delta', runId: 'run-1', from: 'AGENT', payload: { id: 'text-1', text: 'hello' } });
    });
    await waitFor(() => expect(result.current.messages).toHaveLength(1));
    expect(result.current.initialHistoryPagination).toEqual({ hasMore: true });
    await act(async () => result.current.setMessages([]));
    expect(result.current.initialHistoryPagination).toEqual({ hasMore: true });
  });
});
