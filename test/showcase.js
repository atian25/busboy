/* eslint-disable max-len */
'use strict';

const Busboy = require('..');
const { Queue } = require('@toolbuilder/await-for-it');
const stream = require('stream');

class LimitError extends Error {
  constructor({ type, expected, fieldname }) {
    let message = `${type} limit exceeded, should less than ${expected}`;
    if (fieldname) message += ` at field ${fieldname}`;
    super(message);
    this.name = 'LimitError';
    this.type = type;
    this.code = 'LIMIT_EXCEEDED';
    this.status = 413;
    this.fieldname = fieldname;
  }
}

function parse(request, options = {}) {
  options.headers = {};
  for (const [ key, value ] of Object.entries(request.headers)) {
    options.headers[key.toLowerCase()] = value;
  }
  const busboy = Busboy(options);
  const queue = new Queue();

  busboy.on('field', onField);
  busboy.on('file', onFile);
  busboy.on('error', onError);
  busboy.on('close', onClose);

  busboy.on('partsLimit', () => onLimitError('parts'));
  busboy.on('filesLimit', () => onLimitError('files'));
  busboy.on('fieldsLimit', () => onLimitError('fields'));

  function onField(name, value, info) {
    // console.log('field', name, value, info);
    queue.push({ name, value, info });
  }

  function onFile(name, stream, info) {
    // console.log('file', name, stream, info);
    queue.push({ name, stream, info });
    stream.on('limit', () => {
      console.log('limit');
    });
  }

  function onLimitError(type, fieldname) {
    const expected = options.limits[type];
    const error = new LimitError({ type, fieldname, expected });
    onError(error);
  }

  function onClose() {
    console.log('close');
    queue.done();
  }

  function onError(err) {
    queue.reject(err);
  }

  stream.pipeline(request, busboy, (err) => {
    console.log('> pipeline busboy end', err);
    if (err) {
      onError(err);
    } else {
      onClose();
    }
  });

  return queue;
}


const formstream = require('formstream');
async function run() {
  const form = formstream();
  form.field('name', 'tz');
  form.field('field1', 'long-long-long');
  form.field('field-long-key', 'abc');
  form.file('file1', __filename, 'test1.js');
  form.buffer('file2', Buffer.from('abc'), 'test2.js');
  form.file('file3', __filename, 'test2.js');

  const request = new stream.PassThrough();
  request.headers = form.headers();

  stream.pipeline(form, request, (err) => {
    console.log('> pipeline form end', err);
  });

  const parts = parse(request);

  // await new Promise((resolve) => setTimeout(resolve, 1000));

  // // this will work
  // for await (const part of parts) {
  //   console.log(part.name);
  // }

  process.on('exit', (code) => {
    console.log('exit', code);
  });

  process.on('uncaughtException', (err) => {
    console.error('uncaughtException', err);
  });

  // This case don't work
  // Want to consume the stream later, not in the loop
  // But this will not works because async generator don't known whether busboy is parse all the parts
  const streams = [];
  for await (const part of parts) {
    if (part.stream) {
      console.log('@file', part.name);
      streams.push(part.stream);
      // part.stream.resume();
    } else {
      console.log('@field', part.name);
    }
  }

  console.log('@@@')
  // Then consume the stream later
  for (const stream of streams) {
    console.log(stream)
    // stream.resume();
  }
}

run().then(res => { console.log('done', res)}).catch(err => console.error('error', err));
