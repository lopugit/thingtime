const {pm2AppConfig}=require('./scripts/worktree-ports.cjs');
module.exports={apps:[{...pm2AppConfig(__dirname),autorestart:false,watch:false}]};
