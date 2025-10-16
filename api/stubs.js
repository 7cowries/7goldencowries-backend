module.exports = function apiStubs(app) {
  app.get('/api/health',            (req,res)=>res.json({ ok:true }));
  app.get('/api/quests',            (req,res)=>res.json({ ok:true, items: [] }));
  app.get('/api/me',                (req,res)=>res.json({ ok:true, me:null }));
  app.get('/api/users/me',          (req,res)=>res.json({ ok:true, me:null }));
  app.get('/api/profile',           (req,res)=>res.json({ ok:true, profile:null }));
  app.get('/api/v1/payments/status',(req,res)=>res.json({ ok:true, status:'none' }));
};
