const api = require('../../utils/request');

Page({
  data: { rating: 5, content: '', images: [], loading: false },
  onLoad(options) { this.orderId = options.orderId; },
  onRate(e) { this.setData({ rating: e.currentTarget.dataset.val }); },
  onContentInput(e) { this.setData({ content: e.detail.value }); },
  delImg(e) {
    const imgs = [...this.data.images];
    imgs.splice(e.currentTarget.dataset.idx, 1);
    this.setData({ images: imgs });
  },
  chooseImg() {
    wx.chooseMedia({
      count: 6 - this.data.images.length,
      mediaType: ['image'],
      success: (res) => {
        const tasks = res.tempFiles.map(f => this.uploadOne(f.tempFilePath));
        Promise.all(tasks).then(urls => {
          this.setData({ images: [...this.data.images, ...urls] });
        });
      }
    });
  },
  uploadOne(path) {
    return new Promise((resolve, reject) => {
      const app = getApp();
      wx.uploadFile({
        url: 'http://localhost:3000/api/upload',
        filePath: path,
        name: 'file',
        header: { Authorization: `Bearer ${app.globalData.token}` },
        success(res) { const d = JSON.parse(res.data); resolve(d.data.url); },
        fail: reject,
      });
    });
  },
  async onSubmit() {
    if (!this.data.rating) return wx.showToast({ title: '请选择评分', icon: 'none' });
    this.setData({ loading: true });
    try {
      await api.post('/api/reviews', {
        orderId: parseInt(this.orderId),
        rating: this.data.rating,
        content: this.data.content,
        images: this.data.images
      });
      wx.showToast({ title: '评价成功！' });
      setTimeout(() => wx.navigateBack({ delta: 2 }), 1500);
    } catch {
      wx.showToast({ title: '提交失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  }
});
