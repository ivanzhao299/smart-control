/**
 * Jest 配置 (2026-07-19 加固: 从零补测试)。
 *
 * 第一批只测**协议编解码纯函数** —— 它们是"改错一个字节, 编译过、类型过、CI 绿,
 * 直接发到现场对真实硬件发错命令"的最大盲区 (审计 critical #1)。纯函数无 Nest DI /
 * 无 IO, 用文档手册 + 现场实测的已知报文做金标准断言, 回归立刻变红。
 */
/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.spec.ts'],
  clearMocks: true,
  // 只跑协议层, 不因为其它模块缺 DI 上下文而红 (后续再逐步扩)
  testPathIgnorePatterns: ['/node_modules/'],
};
