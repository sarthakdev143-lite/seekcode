const request = require('supertest');
const app = require('./server');
(async () => {
  let res = await request(app).post('/todos').send({ title: 'a' });
  if (res.status !== 201 || !res.body.id) throw new Error('create failed');
  const id = res.body.id;
  res = await request(app).put('/todos/' + id).send({ title: 'b', done: true });
  if (res.status !== 200 || res.body.title !== 'b' || res.body.done !== true) throw new Error('update failed');
  res = await request(app).get('/todos');
  if (!Array.isArray(res.body) || res.body.length !== 1) throw new Error('list failed');
  res = await request(app).delete('/todos/' + id);
  if (res.status !== 204) throw new Error('delete failed');
})().catch(err => { console.error(err.message); process.exit(1); });
