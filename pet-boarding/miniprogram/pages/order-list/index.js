const api = require('../../utils/request');

const STATUS_MAP = { pending: '待确认', confirmed: '已确认', ongoing: '寄养中', completed: '已完成', cancelled: '已取消' };

Page({
  data: {
    orders: [], filtered: [],
    tabs: ['全部', '待确认', '进行中', '已完成', '已取消'],
    activeTab: 0,
    statusMap: STATUS_MAP
  },
  async onShow() {
    const res = await api.get('/api/orders');
    this.allOrders = res.data || [];
    this.filter(this.data.activeTab);
  },
  switchTab(e) {
    const idx = e.currentTarget.dataset.idx;
    this.setData({ activeTab: idx });
    this.filter(idx);
  },
  filter(idx) {
    const groups = [null, ['pending'], ['confirmed', 'ongoing'], ['completed'], ['cancelled']];
    const statuses = groups[idx];
    const filtered = statuses ? this.allOrders.filter(o => statuses.includes(o.status)) : this.allOrders;
    this.setData({ filtered });
  },
  goDetail(e) { wx.navigateTo({ url: `/pages/order-detail/index?id=${e.currentTarget.dataset.id}` }); }
});
