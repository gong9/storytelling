/**
 * 文本切分工具
 */

const MAX_PARAGRAPH_CHARS = 2000;

function splitLongText(text: string, maxChars: number): string[] {
  const chunks: string[] = [];
  let remaining = text;
  
  while (remaining.length > maxChars) {
    let splitIndex = remaining.lastIndexOf('。', maxChars);
    if (splitIndex === -1 || splitIndex < maxChars * 0.5) {
      splitIndex = remaining.lastIndexOf('.', maxChars);
    }
    if (splitIndex === -1 || splitIndex < maxChars * 0.5) {
      splitIndex = maxChars;
    } else {
      splitIndex += 1;
    }
    
    chunks.push(remaining.substring(0, splitIndex).trim());
    remaining = remaining.substring(splitIndex).trim();
  }
  
  if (remaining) {
    chunks.push(remaining);
  }
  
  return chunks;
}

/**
 * 按段落边界切分文本
 */
export function splitIntoParagraphs(content: string, maxChars: number = MAX_PARAGRAPH_CHARS): string[] {
  const rawParagraphs = content.split(/\n\s*\n/).filter(p => p.trim().length > 0);
  
  const paragraphs: string[] = [];
  let currentParagraph = '';
  
  for (const raw of rawParagraphs) {
    const trimmed = raw.trim();
    
    if (currentParagraph.length + trimmed.length + 2 <= maxChars) {
      currentParagraph = currentParagraph 
        ? currentParagraph + '\n\n' + trimmed 
        : trimmed;
    } else {
      if (currentParagraph) {
        paragraphs.push(currentParagraph);
      }
      
      if (trimmed.length > maxChars) {
        const chunks = splitLongText(trimmed, maxChars);
        paragraphs.push(...chunks);
        currentParagraph = '';
      } else {
        currentParagraph = trimmed;
      }
    }
  }
  
  if (currentParagraph) {
    paragraphs.push(currentParagraph);
  }
  
  return paragraphs;
}
