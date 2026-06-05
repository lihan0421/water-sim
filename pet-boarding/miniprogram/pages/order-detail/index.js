const api = require('../../utils/request');

const STATUS_MAP = { pending: '待确认', confirmed: '已确认', ongoing: '寄养中', completed: '已完成', cancelled: '已取消' };

Page({
  data: { order: null, statusMap: STATUS_MAP },
  onLoad(options) { this.orderId = options.id; this.loadOrder(); },
  async loadOrder() {
    const res = await api.get(`/api/orders/${this.orderId}`);
    this.setData({ order: res.data });
  },
  async onCancel() {
    const result = await wx.showModal({ title: '确认取消', content: '确定要取消此预约吗？' });
    if (!result.confirm) return;
    await api.put(`/api/orders/${this.orderId}/status`, { status: 'cancelled' });
    wx.showToast({ title: '已取消' });
    this.loadOrder();
  },
  goReview() {
    wx.navigateTo({ url: `/pages/review-create/index?orderId=${this.orderId}&providerId=${this.data.order.provider_id}` });
  }
});
