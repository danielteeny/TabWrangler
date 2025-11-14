// tabUtils.js - Utility functions for tab matching and grouping

const TabUtils = {
  findDuplicates(tabs, settings) {
    const groups = [];
    const processed = new Set();

    tabs.forEach((tab, index) => {
      if (processed.has(tab.id)) return;

      const duplicates = tabs.filter((otherTab, otherIndex) => {
        if (index === otherIndex || processed.has(otherTab.id)) return false;
        return this.matchTabs(tab, otherTab, settings);
      });

      if (duplicates.length > 0) {
        const group = {
          url: tab.url, // Just show the full URL
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

  matchTabs(tab1, tab2, settings) {
    try {
      const url1 = new URL(tab1.url);
      const url2 = new URL(tab2.url);

      // Check domain
      if (settings.matchDomain) {
        const domain1 = this.getRootDomain(url1.hostname);
        const domain2 = this.getRootDomain(url2.hostname);
        if (domain1 !== domain2) return false;
      }

      // Check subdomain
      if (settings.matchSubdomain) {
        if (url1.hostname !== url2.hostname) return false;
      }

      // Check port
      if (settings.matchPort) {
        if (url1.port !== url2.port) return false;
      }

      // Check path
      if (settings.matchPath) {
        if (url1.pathname !== url2.pathname) return false;
      }

      // Check query parameters
      if (settings.matchQuery) {
        if (url1.search !== url2.search) return false;
      }

      // Check hash
      if (settings.matchHash) {
        if (url1.hash !== url2.hash) return false;
      }

      return true;
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

  // Generate consolidation suggestions based on threshold, domain assignments, and keywords
  async generateConsolidationSuggestions(windows, threshold = 3) {
    const distribution = this.analyzeDomainDistribution(windows);
    const assignedSuggestions = [];
    const keywordSuggestions = [];
    const unassignedSuggestions = [];

    // Load all domain and keyword assignments
    const result = await browser.storage.local.get(['windowDomains', 'windowKeywords']);
    const allDomainAssignments = result.windowDomains || {};
    const allKeywordAssignments = result.windowKeywords || {};

    // Build reverse mapping: domain -> assigned window ID
    const domainToWindow = {};
    for (const windowId in allDomainAssignments) {
      const domains = allDomainAssignments[windowId];
      domains.forEach(domain => {
        domainToWindow[domain] = parseInt(windowId);
      });
    }

    // For each domain, check if it has an assignment
    for (const domain in distribution) {
      const domainData = distribution[domain];
      const windowIds = Object.keys(domainData.windows);

      // Skip if all tabs are in one window
      if (windowIds.length === 1) continue;

      const assignedWindowId = domainToWindow[domain];

      if (assignedWindowId) {
        // Domain has an assignment - suggest moving all tabs to assigned window
        const strayTabs = [];
        windowIds.forEach(windowId => {
          if (parseInt(windowId) !== assignedWindowId) {
            domainData.windows[windowId].tabs.forEach(tab => {
              strayTabs.push({
                tab: tab,
                fromWindowId: parseInt(windowId)
              });
            });
          }
        });

        if (strayTabs.length > 0) {
          const homeWindowTabCount = domainData.windows[assignedWindowId]
            ? domainData.windows[assignedWindowId].tabs.length
            : 0;

          assignedSuggestions.push({
            domain: domain,
            homeWindowId: assignedWindowId,
            homeWindowTabCount: homeWindowTabCount,
            strayTabs: strayTabs,
            totalStrayTabs: strayTabs.length,
            isAssigned: true
          });
        }
      } else {
        // No assignment - use original logic (most tabs wins + threshold)
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
          unassignedSuggestions.push({
            domain: domain,
            homeWindowId: parseInt(homeWindowId),
            homeWindowTabCount: maxTabCount,
            strayTabs: strayTabs,
            totalStrayTabs: strayTabs.length,
            isAssigned: false
          });
        }
      }
    }

    // Check for keyword matches across all tabs
    for (const windowId in allKeywordAssignments) {
      const keywords = allKeywordAssignments[windowId];
      const targetWindowId = parseInt(windowId);
      const keywordMatchedTabs = {};

      // For each window, check all tabs for keyword matches
      windows.forEach(window => {
        if (window.id === targetWindowId) return; // Skip tabs already in target window

        window.tabs.forEach(tab => {
          try {
            const tabUrl = tab.url.toLowerCase();
            const tabTitle = (tab.title || '').toLowerCase();
            const url = new URL(tab.url);
            const tabDomain = url.hostname.toLowerCase();

            // Check each keyword
            for (const keyword of keywords) {
              const keywordLower = keyword.toLowerCase();
              if (tabUrl.includes(keywordLower) || tabTitle.includes(keywordLower) || tabDomain.includes(keywordLower)) {
                // This tab matches a keyword
                if (!keywordMatchedTabs[keyword]) {
                  keywordMatchedTabs[keyword] = [];
                }
                keywordMatchedTabs[keyword].push({
                  tab: tab,
                  fromWindowId: window.id
                });
                break; // Only count each tab once per window
              }
            }
          } catch (e) {
            // Skip invalid URLs
          }
        });
      });

      // Create suggestions for each keyword that has matches
      for (const keyword in keywordMatchedTabs) {
        const strayTabs = keywordMatchedTabs[keyword];
        if (strayTabs.length > 0) {
          keywordSuggestions.push({
            domain: `Keyword: "${keyword}"`,
            homeWindowId: targetWindowId,
            homeWindowTabCount: 0, // Keyword suggestions don't have a home tab count
            strayTabs: strayTabs,
            totalStrayTabs: strayTabs.length,
            isKeywordMatch: true,
            keyword: keyword
          });
        }
      }
    }

    // Sort all lists by number of stray tabs
    assignedSuggestions.sort((a, b) => b.totalStrayTabs - a.totalStrayTabs);
    keywordSuggestions.sort((a, b) => b.totalStrayTabs - a.totalStrayTabs);
    unassignedSuggestions.sort((a, b) => b.totalStrayTabs - a.totalStrayTabs);

    // Return assigned suggestions first, then keyword matches, then unassigned
    return [...assignedSuggestions, ...keywordSuggestions, ...unassignedSuggestions];
  },

  // Window metadata helpers
  async getWindowNickname(windowId) {
    try {
      const result = await browser.storage.local.get('windowNicknames');
      const nicknames = result.windowNicknames || {};
      return nicknames[windowId] || null;
    } catch (e) {
      console.error('Error getting window nickname:', e);
      return null;
    }
  },

  async getWindowDomains(windowId) {
    try {
      const result = await browser.storage.local.get('windowDomains');
      const domains = result.windowDomains || {};
      return domains[windowId] || [];
    } catch (e) {
      console.error('Error getting window domains:', e);
      return [];
    }
  },

  async formatWindowDisplay(windowId) {
    const nickname = await this.getWindowNickname(windowId);
    return nickname || `Window ${windowId}`;
  },

  // Get all unique domains from a set of windows (excluding pinned tabs)
  getAllDomains(windows) {
    const domainsSet = new Set();

    windows.forEach(window => {
      window.tabs.forEach(tab => {
        // Skip pinned tabs
        if (tab.pinned) return;

        try {
          const url = new URL(tab.url);
          const domain = this.getRootDomain(url.hostname);
          const key = url.port ? `${domain}:${url.port}` : domain;
          domainsSet.add(key);
        } catch (e) {
          // Skip invalid URLs
        }
      });
    });

    return Array.from(domainsSet).sort();
  }
};

if (typeof window !== 'undefined') {
  window.TabUtils = TabUtils;
}
