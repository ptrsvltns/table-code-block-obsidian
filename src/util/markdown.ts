export function parseTableRowFromLine(text: string): Array<string> {
  const support = ["[", "(", "{", "`", "'", '"'];
  const flags: Record<string, string> = {
    "[": "]",
    "(": ")",
    "{": "}",
    "`": "`",
    "'": "'",
    '"': '"'
  }
  let lastIsFlag = false;
  const result: Array<string> = [];
  let target = [];
  let targetFlag = "";
  for (let i = 0; i < text.length; i++) {
    const x = text[i];
    if (!targetFlag && x === "|") {
      if (target.length) {
        result.push(target.join("").trim());
        target = [];
      }
      continue;
    }
    const flag = support.indexOf(x) != -1;
    if (!targetFlag && flag) {
      targetFlag = x;
    }
    target.push(x);
    if (x === flags[targetFlag]) {
      if (lastIsFlag && x === "`") {
        continue;
      }
      if (i + 1 == text.length || text[i + 1] !== flags[targetFlag]) {
        targetFlag = "";
        continue;
      }
    }
    lastIsFlag = flag;
  }
  if (target.length) result.push(target.join("").trim());
  return result;
}