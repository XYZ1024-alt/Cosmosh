/**
 * Masks server address text for privacy-oriented list rendering.
 *
 * IPv4 keeps the first two segments; IPv6 keeps the first two hextets;
 * non-IP hosts keep a short prefix with asterisks.
 *
 * @param address Raw host/address value.
 * @returns Masked address value.
 */
export const maskServerAddress = (address: string): string => {
  const normalizedAddress = address.trim();
  if (!normalizedAddress) {
    return normalizedAddress;
  }

  const ipv4Parts = normalizedAddress.split('.');
  const isIpv4Address =
    ipv4Parts.length === 4 &&
    ipv4Parts.every((part) => {
      if (!/^\d{1,3}$/.test(part)) {
        return false;
      }

      const value = Number(part);
      return value >= 0 && value <= 255;
    });

  if (isIpv4Address) {
    return `${ipv4Parts[0]}.${ipv4Parts[1]}.*.*`;
  }

  if (normalizedAddress.includes(':')) {
    const ipv6Segments = normalizedAddress.split(':').filter((segment) => segment.length > 0);
    if (ipv6Segments.length >= 2) {
      return `${ipv6Segments[0]}:${ipv6Segments[1]}:*:*`;
    }
  }

  if (normalizedAddress.length <= 2) {
    return '*'.repeat(normalizedAddress.length);
  }

  return `${normalizedAddress.slice(0, 2)}***${normalizedAddress.slice(-1)}`;
};

/**
 * Resolves address text to display in UI lists based on privacy setting.
 *
 * @param address Raw host/address value.
 * @param showFullServerAddress Whether full address should be shown.
 * @returns Full or masked address for display.
 */
export const resolveServerAddressForDisplay = (address: string, showFullServerAddress: boolean): string => {
  return showFullServerAddress ? address : maskServerAddress(address);
};
