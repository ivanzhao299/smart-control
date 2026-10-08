import {
  apiHostForRegion,
  makeApiSign,
  makeAuthorizationSign,
  makeNonce,
} from './ewelink-crypto';

describe('ewelink crypto', () => {
  it('授权页 authorization 签名匹配官方文档向量 (secret=abc, clientId=ABC, seq=123)', () => {
    expect(makeAuthorizationSign('abc', 'ABC', '123')).toBe(
      'v1+mfNY2ukxswM8sZOTg99srZsVnUVv9DGXeav1096M=',
    );
  });

  it('REST Sign 确定且可复现', () => {
    const a = makeApiSign('abc', 'x=1');
    expect(typeof a).toBe('string');
    expect(a).toBe(makeApiSign('abc', 'x=1'));
    expect(a).not.toBe(makeApiSign('abc', 'x=2'));
  });

  it('nonce 长度与字符集', () => {
    const n = makeNonce(8);
    expect(n).toHaveLength(8);
    expect(/^[A-Za-z0-9]{8}$/.test(n)).toBe(true);
  });

  it('区域 host 解析，未知回落中国区', () => {
    expect(apiHostForRegion('cn')).toContain('coolkit.cn');
    expect(apiHostForRegion('as')).toContain('coolkit.cc');
    expect(apiHostForRegion(null)).toBe(apiHostForRegion('cn'));
  });
});
