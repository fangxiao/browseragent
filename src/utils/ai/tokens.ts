// token 估算(纯函数):CJK 约 1 token/字,拉丁约 1 token/4 字符
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const cjk =
    text.match(/[一-鿿㐀-䶿豈-﫿]/g)?.length ?? 0;
  const other = text.length - cjk;
  return Math.ceil(cjk + other / 4);
}
