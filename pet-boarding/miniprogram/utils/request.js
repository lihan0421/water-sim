const BASE_URL = 'http://localhost:3000';

function request(method, path, data) {
  return new Promise((resolve, reject) => {
    const app = getApp();
    wx.request({
      url: BASE_URL + path,
      method,
      data,
      header: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${app.globalData.token || ''}`
      },
      success(res) {
        if (res.data.code === 401) {
          wx.reLaunch({ url: '/pages/login/index' });
          return reject(new Error('Unauthorized'));
        }
        resolve(res.data);
      },
      fail: reject,
    });
  });
}

module.exports = {
  get: (path) => request('GET', path),
  post: (path, data) => request('POST', path, data),
  put: (path, data) => request('PUT', path, data),
  del: (path) => request('DELETE', path),
};
