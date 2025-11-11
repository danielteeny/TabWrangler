// tabUtils.js - Utility functions for tab matching and grouping

const TabUtils = {
  findDuplicates(tabs, matchMode = 'domain') {
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

  matchTabs(tab1, tab2, matchMode) {
    try {
      const url1 = new URL(tab1.url);
      const url2 = new URL(tab2.url);

      switch (matchMode) {
        case 'exact':
          return tab1.url === tab2.url;

        case 'domain':
          return this.getRootDomain(url1.hostname) === this.getRootDomain(url2.hostname);

        case 'subdomain':
          return url1.host === url2.host;

        case 'path':
          return url1.hostname === url2.hostname && url1.pathname === url2.pathname;

        case 'fullpath':
          return url1.hostname === url2.hostname &&
                 url1.pathname === url2.pathname &&
                 url1.search === url2.search;

        default:
          return this.getRootDomain(url1.hostname) === this.getRootDomain(url2.hostname);
      }
    } catch (e) {
      return false;
    }
  },

  getRootDomain(hostname) {
    const parts = hostname.split('.');
    if (parts.length <= 2) return hostname;
    return parts.slice(-2).join('.');
  },

  getDisplayUrl(url, matchMode) {
    try {
      const urlObj = new URL(url);

      switch (matchMode) {
        case 'exact':
          return url;

        case 'domain':
          return this.getRootDomain(urlObj.hostname);

        case 'subdomain':
          return urlObj.host;

        case 'path':
          return urlObj.hostname + urlObj.pathname;

        case 'fullpath':
          return urlObj.hostname + urlObj.pathname + urlObj.search;

        default:
          return urlObj.hostname;
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

        if (!groups[domain]) {
          groups[domain] = [];
        }

        groups[domain].push(tab);
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
  }
};

if (typeof window !== 'undefined') {
  window.TabUtils = TabUtils;
}
