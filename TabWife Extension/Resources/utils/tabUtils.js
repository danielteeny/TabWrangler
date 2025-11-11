// tabUtils.js - Utility functions for tab matching and grouping

const TabUtils = {
  findDuplicates(tabs, matchMode = 'fullpath') {
    const groups = [];
    const processed = new Set();

    tabs.forEach((tab, index) => {
      if (processed.has(tab.id)) return;

      const duplicates = tabs.filter((otherTab, otherIndex) => {
        if (index === otherIndex || processed.has(otherTab.id)) return false;
        return this.matchTabs(tab, otherTab, matchMode);
      });

      if (duplicates.length > 0) {
        const group = {
          url: this.getDisplayUrl(tab.url, matchMode),
          tabs: [tab, ...duplicates]
        };

        group.tabs.forEach(t => processed.add(t.id));
        groups.push(group);
      }
    });

    const totalDuplicates = groups.reduce((sum, group) => sum + group.tabs.length - 1, 0);

    return { groups, totalDuplicates };
  },

  isIPAddress(hostname) {
    // Check for IPv4
    const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}$/;
    // Check for IPv6 (simplified)
    const ipv6Pattern = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;
    return ipv4Pattern.test(hostname) || ipv6Pattern.test(hostname) || hostname === 'localhost';
  },

  matchTabs(tab1, tab2, matchMode) {
    try {
      const url1 = new URL(tab1.url);
      const url2 = new URL(tab2.url);

      switch (matchMode) {
        case 'exact':
          return tab1.url === tab2.url;

        case 'port':
          // Match hostname + port (perfect for self-hosted services)
          return url1.hostname === url2.hostname && url1.port === url2.port;

        case 'domain':
          return this.getRootDomain(url1.hostname) === this.getRootDomain(url2.hostname);

        case 'subdomain':
          return url1.host === url2.host;

        case 'path':
          return url1.hostname === url2.hostname &&
                 url1.port === url2.port &&
                 url1.pathname === url2.pathname;

        case 'fullpath':
          return url1.hostname === url2.hostname &&
                 url1.port === url2.port &&
                 url1.pathname === url2.pathname &&
                 url1.search === url2.search;

        default:
          return url1.hostname === url2.hostname &&
                 url1.port === url2.port &&
                 url1.pathname === url2.pathname &&
                 url1.search === url2.search;
      }
    } catch (e) {
      return false;
    }
  },

  getRootDomain(hostname) {
    // For IP addresses or localhost, return as-is
    if (this.isIPAddress(hostname)) {
      return hostname;
    }

    // For domain names, extract root domain
    const parts = hostname.split('.');
    if (parts.length <= 2) return hostname;
    return parts.slice(-2).join('.');
  },

  getDisplayUrl(url, matchMode) {
    try {
      const urlObj = new URL(url);
      const hostWithPort = urlObj.port ? `${urlObj.hostname}:${urlObj.port}` : urlObj.hostname;

      switch (matchMode) {
        case 'exact':
          return url;

        case 'port':
          return hostWithPort;

        case 'domain':
          return this.getRootDomain(urlObj.hostname);

        case 'subdomain':
          return urlObj.host;

        case 'path':
          return hostWithPort + urlObj.pathname;

        case 'fullpath':
          return hostWithPort + urlObj.pathname + urlObj.search;

        default:
          return hostWithPort + urlObj.pathname + urlObj.search;
      }
    } catch (e) {
      return url;
    }
  },

  groupByDomain(tabs) {
    const groups = {};

    tabs.forEach(tab => {
      try {
        const url = new URL(tab.url);
        const domain = this.getRootDomain(url.hostname);
        const key = url.port ? `${domain}:${url.port}` : domain;

        if (!groups[key]) {
          groups[key] = [];
        }

        groups[key].push(tab);
      } catch (e) {
        // Skip invalid URLs
      }
    });

    return groups;
  },

  sortByDomain(tabs) {
    return tabs.sort((a, b) => {
      try {
        const domainA = this.getRootDomain(new URL(a.url).hostname);
        const domainB = this.getRootDomain(new URL(b.url).hostname);
        return domainA.localeCompare(domainB);
      } catch (e) {
        return 0;
      }
    });
  },

  // Analyze domain distribution across all windows
  analyzeDomainDistribution(windows) {
    const distribution = {};

    windows.forEach(window => {
      window.tabs.forEach(tab => {
        try {
          const url = new URL(tab.url);
          const domain = this.getRootDomain(url.hostname);
          const key = url.port ? `${domain}:${url.port}` : domain;

          if (!distribution[key]) {
            distribution[key] = {
              domain: key,
              totalTabs: 0,
              windows: {}
            };
          }

          if (!distribution[key].windows[window.id]) {
            distribution[key].windows[window.id] = {
              windowId: window.id,
              tabs: []
            };
          }

          distribution[key].windows[window.id].tabs.push(tab);
          distribution[key].totalTabs++;
        } catch (e) {
          // Skip invalid URLs
        }
      });
    });

    return distribution;
  },

  // Generate consolidation suggestions based on threshold
  generateConsolidationSuggestions(windows, threshold = 3) {
    const distribution = this.analyzeDomainDistribution(windows);
    const suggestions = [];

    // For each domain, find if there's a "home" window with enough tabs
    for (const domain in distribution) {
      const domainData = distribution[domain];
      const windowIds = Object.keys(domainData.windows);

      // Skip if all tabs are in one window
      if (windowIds.length === 1) continue;

      // Find the window with the most tabs for this domain
      let homeWindowId = null;
      let maxTabCount = 0;

      windowIds.forEach(windowId => {
        const count = domainData.windows[windowId].tabs.length;
        if (count > maxTabCount) {
          maxTabCount = count;
          homeWindowId = windowId;
        }
      });

      // Only suggest if home window meets threshold
      if (maxTabCount < threshold) continue;

      // Collect stray tabs from other windows
      const strayTabs = [];
      windowIds.forEach(windowId => {
        if (windowId !== homeWindowId) {
          domainData.windows[windowId].tabs.forEach(tab => {
            strayTabs.push({
              tab: tab,
              fromWindowId: parseInt(windowId)
            });
          });
        }
      });

      if (strayTabs.length > 0) {
        suggestions.push({
          domain: domain,
          homeWindowId: parseInt(homeWindowId),
          homeWindowTabCount: maxTabCount,
          strayTabs: strayTabs,
          totalStrayTabs: strayTabs.length
        });
      }
    }

    // Sort by number of stray tabs (most impactful first)
    return suggestions.sort((a, b) => b.totalStrayTabs - a.totalStrayTabs);
  }
};

if (typeof window !== 'undefined') {
  window.TabUtils = TabUtils;
}
