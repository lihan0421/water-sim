const api = require('../../utils/request');

Page({
  data: { userInfo: {} },
  async onShow() {
    const app = getApp();
    if (!app.isLoggedIn()) return wx.reLaunch({ url: '/pages/login/index' });
    const res = await api.get('/api/users/me');
    app.globalData.userInfo = res.data;
    wx.setStorageSync('userInfo', res.data);
    this.setData({ userInfo: res.data });
  },
  goPets() { wx.navigateTo({ url: '/pages/pet-list/index' }); },
  goShopEdit() { wx.navigateTo({ url: '/pages/shop-edit/index' }); },
  goProviderOrders() { wx.navigateTo({ url: '/pages/provider-orders/index' }); },
  goProviderReviews() { wx.navigateTo({ url: '/pages/provider-reviews/index' }); },
  async becomeProvider() {
    const result = await wx.showModal({ title: '成为服务商', content: '切换后可创建店铺接受预约，是否继续？' });
    if (!result.confirm) return;
    await api.put('/api/users/me/role', {});
    wx.showToast({ title: '已成为服务商' });
    this.onShow();
  },
  onLogout() {
    getApp().logout();
    wx.reLaunch({ url: '/pages/login/index' });
  }
});
