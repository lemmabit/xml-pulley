import { parser as saxParser } from 'sax';

function isAllowedType(type) {
  switch(type) {
    case 'text': case 'opentag': case 'closetag': case 'doctype':
    case 'processinginstruction': case 'attribute': case 'comment':
    case 'opencdata': case 'closecdata': case 'opennamespace':
    case 'closenamespace': return true;
    default: return false;
  }
}

export function makePulley(xml, options) {
  let self;
  
  if(!options) options = {};
  let types = options.types || ['opentag', 'closetag', 'text'];
  let queue = [];
  let parser = saxParser(true, {
    xmlns: options.xmlns,
    position: false
  });
  let skipWS = options.skipWhitespaceOnly;
  let trim = options.trim, normalize = options.normalize;
  let textOpts = (t) => {
    if(trim)
      t = t.trim();
    if(normalize)
      t = t.replace(/\s+/g, " ")
    return t;
  };
  let text = null, rawText = null, wsText = null, wsRawText = null;
  let flushText = () => {
    if(skipWS && wsText !== null) {
      queue.push({
        type: 'wstext',
        text: wsText,
        rawText: wsRawText,
        wsHasNext: text !== null
      });
      wsText = wsRawText = null;
    }
    if(text !== null) {
      queue.push({
        type: 'text',
        text,
        rawText
      });
      text = rawText = null;
    }
  };
  parser.onerror = (err) => {
    throw err;
  };
  types.forEach((type) => {
    if(type === 'text') {
      parser.ontext = (t) => {
        let pt = textOpts(t);
        if(skipWS) {
          if(wsText) {
            wsText += pt; wsRawText += t;
          } else {
            wsText = pt; wsRawText = t;
          }
        }
        if(!skipWS || /\S/.test(t)) {
          if(text) {
            text += pt; rawText += t;
          } else {
            text = pt; rawText = t;
          }
        }
      };
      parser.oncdata = (t) => {
        if(text) {
          text += t; rawText += t;
        } else {
          text = rawText = t;
        }
      };
    } else if(type === 'comment') {
      parser.oncomment = (t) => {
        flushText();
        queue.push({
          type: 'comment',
          text: textOpts(t),
          rawText: t
        });
      }
    } else if(type === 'doctype') {
      parser.ondoctype = (t) => {
        flushText();
        queue.push({
          type: 'doctype',
          text: t
        });
      }
    } else if(type === 'closetag') {
      parser.onclosetag = (t) => {
        flushText();
        queue.push({
          type: 'closetag',
          name: t
        });
      }
    } else if(type === 'opencdata' || type === 'closecdata' ||
              type === 'opennamespace' || type === 'closenamespace') {
      parser['on'+type] = (data) => {
        flushText();
        queue.push({ type: type });
      }
    } else if(isAllowedType(type)) {
      parser['on'+type] = (data) => {
        flushText();
        data.type = type;
        queue.push(data);
      }
    } else {
      throw new Error(`${type} isn't an allowed type!`);
    }
  });
  parser.write(xml).close();
  flushText();
  queue.reverse();
  
  let next = skipWS ? () => {
    let out;
    while((out = queue.pop()) && out.type === 'wstext') {  }
    return out;
  } : () => queue.pop();
  let peek = skipWS ? () => {
    for(let i = queue.length - 1; i >= 0; --i) {
      let v = queue[i];
      if(v.type !== 'wstext') return v;
    }
  } : () => queue[queue.length - 1];
  let nextText = () => {
    let v = queue[queue.length - 1];
    if(v && v.type === 'text') {
      return queue.pop();
    } else if(v && v.type === 'wstext') {
      queue.pop();
      if(v.wsHasNext) queue.pop();
      v.type = 'text';
      delete v.wsHasNext;
      return v;
    } else {
      return { type: 'text', text: '', rawText: '' };
    }
  }
  let peekText = () => {
    let v = queue[queue.length - 1];
    if(v && v.type === 'text') {
      return v;
    } else if(v && v.type === 'wstext') {
      return { type: 'text', text: v.text, rawText: v.rawText };
    } else {
      return { type: 'text', text: '', rawText: '' };
    }
  }
  let check = (type, error) => {
    let out = peek();
    assertType(out, type, error);
    return out;
  }
  let checkName = (name, type, wrongNameError, wrongTypeError) => {
    type = type || 'opentag';
    let out = peek();
    assertType(out, type, wrongTypeError || wrongNameError);
    assertName(out, name, wrongNameError);
    return out;
  }
  let expect = (type, error) => {
    let out = check(type, error);
    next();
    return out;
  }
  let expectName = (name, type, wrongNameError, wrongTypeError) => {
    let out = checkName(name, type, wrongNameError, wrongTypeError);
    next();
    return out;
  }
  let loop = (callback, endType) => {
    endType = endType || 'closetag';
    let node;
    while((node = peek()) && node.type !== endType) {
      if(callback(self))
        break;
    }
  }
  let loopTag = (callback, name) => {
    let tag = name ? expectName(name) : expect('opentag');
    let node;
    while((node = peek()) && node.type !== 'closetag') {
      callback(self, tag);
    }
    expectName(tag.name, 'closetag');
    return tag;
  }
  let skipTag = (name) => {
    return loopTag((pulley) => {
      let tag = pulley.peek();
      if(tag.type === 'opentag') {
        pulley.skipTag(tag.name);
      } else {
        pulley.next();
      }
    }, name);
  }
  return self = {
    next,
    peek,
    nextText,
    peekText,
    check,
    checkName,
    expect,
    expectName,
    loop,
    loopTag,
    skipTag
  };
}


export function assertType(node, type, error) {
  if(node === undefined) {
    throw error || new Error(`Expected ${type}; got end of file!`);
  } else if(node.type !== type) {
    throw error || new Error(`Expected ${type}; got ${node.type}: ${nodeRepr(node)}!`);
  }
}
export function assertName(tag, name, error) {
  if(tag.name !== name) {
    throw error ||
          new Error(`${tag.type} had name ${tag.name} instead of ${name}!`);
  }
}

export function nodeRepr(tag) {
  switch(tag.type) {
    case 'text': case 'comment': return `"${tag.text}"`;
    case 'opentag': return `<${tag.name}>`;
    case 'closetag': return `</${tag.name}>`;
    case 'doctype': return `<!${tag.text}>`;
    case 'processinginstruction': return `<?${tag.name} ${tag.body}?>`;
    case 'attribute': return `${tag.name}="${tag.value}"`;
    default:
  }
}
