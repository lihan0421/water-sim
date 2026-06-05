const api = require('../../utils/request');

Page({
  data: {
    providers: [],
    loading: false,
    speciesOptions: ['全部', '狗', '猫', '其他'],
    speciesIndex: 0,
    sortOptions: ['综合排序', '价格最低', '评分最高'],
    sortIndex: 0
  },
  onLoad() { this.loadProviders(); },
  onSpeciesChange(e) { this.setData({ speciesIndex: e.detail.value }); this.loadProviders(); },
  onSortChange(e) { this.setData({ sortIndex: e.detail.value }); this.loadProviders(); },
  async loadProviders() {
    this.setData({ loading: true });
    try {
      const speciesMap = { 1: 'dog', 2: 'cat', 3: 'other' };
      const species = speciesMap[this.data.speciesIndex] || '';
      const query = species ? `?species=${species}` : '';
      const res = await api.get(`/api/providers${query}`);
      let list = res.data || [];
      if (this.data.sortIndex === 1) list.sort((a, b) => a.price_per_day - b.price_per_day);
      if (this.data.sortIndex === 2) list.sort((a, b) => b.avg_rating - a.avg_rating);
      this.setData({ providers: list });
    } finally { this.setData({ loading: false }); }
  },
  goDetail(e) { wx.navigateTo({ url: `/pages/provider-detail/index?id=${e.currentTarget.dataset.id}` }); }
});
