export function notFound(req,res){if(req.path.startsWith('/api/'))return res.status(404).json({ok:false,error:'Not found'});res.status(404).send('Page not found');}

export function errorHandler(err,req,res,next){
  console.error('[Learnora]',err);
  if(res.headersSent)return next(err);
  if(req.path.startsWith('/api/'))return res.status(err.status||500).json({ok:false,error:err.message||'Server error'});

  // During local development, show the actual server error instead of
  // redirecting back to the referring page and hiding the root cause.
  if(process.env.NODE_ENV !== 'production') {
    const message=String(err?.stack || err?.message || err || 'Unknown server error');
    return res.status(err.status||500).type('text').send(`Learnora server error\n\n${message}`);
  }

  req.flash('danger',err.message||'Something went wrong.');
  return res.status(err.status||500).redirect(req.get('referer')||'/');
}
