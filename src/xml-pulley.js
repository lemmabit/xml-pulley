import { parser as saxParser } from 'sax';
import Queue from './queue.js';

function isAllowedType(type) {
  switch(type) {
    case 'text': case 'opentag': case 'closetag': case 'doctype':
    case 'processinginstruction': case 'attribute': case 'comment':
    case 'opencdata': case 'closecdata': case 'opennamespace':
    case 'closenamespace': return true;
    default: return false;
  }
}

class XMLPulley {
  constructor(xml, options) {
    if(!options) options = {};
    let types = options.types || ['opentag', 'closetag', 'text'];
    let queue = this.queue = new Queue();
    let parser = saxParser(true, {
      xmlns: options.xmlns,
      position: false
    });
    let skipWS = options.skipWhitespaceOnly;
    let trim = options.trim, normalize = options.normalize;
    function textOpts(t) {
      if(trim)
        t = t.trim();
      if(normalize)
        t = t.replace(/\s+/g, " ")
      return t;
    }
    let text = null, rawText = null;
    let flushText = () => {
      if(text !== null) {
        this.queue.enqueue({
          type: 'text',
          text: text,
          rawText: rawText
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
          if(!skipWS || /\S/.test(t)) {
            let pt = textOpts(t);
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
      } else if(type === 'comment' && (trim || normalize)) {
        parser.oncomment = (t) => {
          flushText();
          queue.enqueue({
            type: 'comment',
            text: textOpts(t),
            rawText: t
          });
        }
      } else if(type === 'closetag') {
        parser.onclosetag = (t) => {
          flushText();
          queue.enqueue({
            type: 'closetag',
            name: t
          });
        }
      } else if(isAllowedType(type)) {
        parser['on'+type] = (data) => {
          flushText();
          data.type = type;
          queue.enqueue(data);
        }
      } else {
        throw new Error(`${type} isn't an allowed type!`);
      }
    });
    parser.write(xml).close();
    flushText();
  }
  next() {
    return this.queue.dequeue();
  }
  peek() {
    return this.queue.peek();
  }
  expect(type) {
    let out = this.peek();
    if(out === undefined) {
      throw new Error(`Expected ${type}; got end of file!`);
    } else if(out.type !== type) {
      throw new Error(`Expected ${type}; got ${out.type}!`);
    }
    this.next();
    return out;
  }
  nextAll(callback, tagName) {
    var node;
    while((node = this.peek()).type !== 'closetag') {
      if(callback(node, this))
        break;
      this.next();
    }
    if(tagName)
      assertName(this.next(), tagName);
  }
  expectAll(callback, type, tagName) {
    var node;
    while((node = this.peek()).type !== 'closetag') {
      if(node.type !== type)
        throw new Error(`Expected ${type}; got ${node.type}!`);
      if(callback(node, this))
        break;
      this.next();
    }
    if(tagName)
      assertName(this.next(), tagName);
  }
}

export function makePulley(xml, options) {
  return new XMLPulley(xml, options);
}

export function assertName(tag, name, error) {
  if(tag.name !== name) {
    throw error ||
          new Error(`${tag.type} had type ${tag.name} instead of ${name}!`);
  }
}
