import { defineConfig } from 'vite';
import {createTimetableApi} from './server/timetable-api.mjs';
for(const file of ['.env.local','.env.server']){try{process.loadEnvFile(file);}catch(e){if(e.code!=='ENOENT')throw e;}}
export default defineConfig({base:'./',server:{fs:{deny:['.env*','**/.env*','**/server/**','**/.git/**']}},plugins:[{
  name:'timetable-image-api',
  configureServer(server){server.middlewares.use(createTimetableApi());},
  configurePreviewServer(server){server.middlewares.use(createTimetableApi());}
}],build:{rollupOptions:{input:{dashboard:'index.html',analysis:'analysis.html',astryx:'astryx.html',astryxAnalysis:'astryx-analysis.html'}}}});
