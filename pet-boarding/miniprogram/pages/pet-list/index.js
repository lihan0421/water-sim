const api = require('../../utils/request');

Page({
  data: { pets: [] },
  async onShow() {
    const res = await api.get('/api/pets');
    this.setData({ pets: res.data || [] });
  },
  goEdit(e) { wx.navigateTo({ url: `/pages/pet-edit/index?id=${e.currentTarget.dataset.id}` }); },
  goAdd() { wx.navigateTo({ url: '/pages/pet-edit/index' }); }
});
