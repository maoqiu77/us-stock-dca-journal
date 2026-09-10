const { service } = require('../../lib/core');
Page({ data: { error: '', revisions: [] }, onLoad(options = {}) { try { this.setData({ revisions: service.revisionHistory(options.recordId), error: '' }); } catch (e) { this.setData({ revisions: [], error: e.message }); } } });
