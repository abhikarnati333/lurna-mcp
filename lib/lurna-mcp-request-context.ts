import { AsyncLocalStorage } from "node:async_hooks";

export type LurnaMcpRequestContext = {
  /** Raw Bearer token from incoming `/mcp` `Authorization` header (no `Bearer ` prefix). */
  bearerToken: string | null;
};

export const lurnaMcpRequestStore = new AsyncLocalStorage<LurnaMcpRequestContext>();

export function getLurnaMcpRequest(): LurnaMcpRequestContext | undefined {
  return lurnaMcpRequestStore.getStore();
}
