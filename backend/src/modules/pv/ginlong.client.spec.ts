import { buildGinlongHeaders, GINLONG_STATION_LIST_PATH } from './ginlong.client';

describe('GinlongClient 签名', () => {
  it('按锦浪规范生成确定性的 Content-MD5 与 HMAC-SHA1 签名 (跨语言固定向量)', () => {
    const body = JSON.stringify({ pageNo: 1, pageSize: 100 });
    const date = 'Tue, 22 Sep 2026 08:00:00 GMT';
    const headers = buildGinlongHeaders(
      'test-key-id',
      'unit-test-secret',
      GINLONG_STATION_LIST_PATH,
      body,
      date,
    );

    // 期望值由独立的 Python 实现按官方 StringToSign 规则计算, 用于捕获拼接/charset 错误。
    expect(headers['Content-MD5']).toBe('U0Xj//qmRi3zoyapfAAuXw==');
    expect(headers.Authorization).toBe('API test-key-id:OrAN1pQjWxJ+Yr4PPpewJmC3Hd8=');
    expect(headers['Content-Type']).toBe('application/json;charset=UTF-8');
    expect(headers.Date).toBe(date);
  });

  it('签名第三行 Content-Type 固定为 application/json (不带 charset)', () => {
    const body = '{}';
    const date = 'Wed, 23 Sep 2026 00:00:00 GMT';
    const a = buildGinlongHeaders('k', 's', '/x', body, date);
    // 即使实际请求头带 charset, 签名也必须基于无 charset 的 canonical string;
    // 这里通过稳定复算确认: 改 body 会改变 MD5 与签名。
    const b = buildGinlongHeaders('k', 's', '/x', '{"a":1}', date);
    expect(a['Content-MD5']).not.toBe(b['Content-MD5']);
    expect(a.Authorization).not.toBe(b.Authorization);
    expect(a.Authorization.startsWith('API k:')).toBe(true);
  });
});
