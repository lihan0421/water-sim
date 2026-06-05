const { login } = require('../../utils/auth');

Page({
  data: { loading: false },
  async onLogin() {
    this.setData({ loading: true });
    try {
      await login();
      wx.switchTab({ url: '/pages/index/index' });
    } catch (e) {
      wx.showToast({ title: '登录失败，请重试', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  }
});
