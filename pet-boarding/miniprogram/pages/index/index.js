const api = require('../../utils/request');

Page({
  data: {
    providers: [],
    loading: false,
    keyword: '',
    speciesOptions: ['全部', '狗', '猫', '其他'],
    speciesIndex: 0
  },
  onLoad() { this.loadProviders(); },
  onShow() {
    const app = getApp();
    if (!app.isLoggedIn()) wx.reLaunch({ url: '/pages/login/index' });
  },
  onSpeciesChange(e) { this.setData({ speciesIndex: e.detail.value }); },
  onKeywordInput(e) { this.setData({ keyword: e.detail.value }); },
  onSearch() { this.loadProviders(); },
  async loadProviders() {
    this.setData({ loading: true });
    try {
      const speciesMap = { 1: 'dog', 2: 'cat', 3: 'other' };
      const species = speciesMap[this.data.speciesIndex] || '';
      const query = species ? `?species=${species}` : '';
      const res = await api.get(`/api/providers${query}`);
      let list = res.data || [];
      if (this.data.keyword) {
        list = list.filter(p => p.shop_name.includes(this.data.keyword));
      }
      this.setData({ providers: list });
    } finally {
      this.setData({ loading: false });
    }
  },
  goDetail(e) {
    wx.navigateTo({ url: `/pages/provider-detail/index?id=${e.currentTarget.dataset.id}` });
  }
});
