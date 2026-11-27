// SF-118's header-safe address test, on its own so client code can use it (SF-129 compose-rules.ts): one mailbox
// "local@domain" with nothing that could change an email header's meaning (spaces, CR/LF, <, >, quotes, commas…).
export const HEADER_ADDRESS = /^[^\s@<>()",;:\\[\]]+@[^\s@<>()",;:\\[\]]+$/;

export function isHeaderAddress(address: string): boolean {
  return HEADER_ADDRESS.test(address);
}
