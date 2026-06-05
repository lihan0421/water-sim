const api = require('../../utils/request');

Page({
  data: { provider: null, reviews: [] },
  onLoad(options) {
    this.providerId = options.id;
    this.loadData();
  },
  async loadData() {
    const [p, r] = await Promise.all([
      api.get(`/api/providers/${this.providerId}`),
      api.get(`/api/reviews/provider/${this.providerId}`),
    ]);
    this.setData({ provider: p.data, reviews: r.data || [] });
  },
  goBook() {
    wx.navigateTo({ url: `/pages/order-create/index?providerId=${this.providerId}&pricePerDay=${this.data.provider.price_per_day}` });
  },
  previewImg(e) {
    wx.previewImage({ current: e.currentTarget.dataset.src, urls: e.currentTarget.dataset.list });
  }
});
