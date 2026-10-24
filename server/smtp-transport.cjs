// Build-only entry: Vite bundles this and Nodemailer into the private dist/server runtime.
module.exports=options=>require('nodemailer').createTransport(options);
