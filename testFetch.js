import 'dotenv/config';

const url = process.env.VITE_SUPABASE_URL + '/rest/v1/quotes?select=id,status,client_id,agent_id,invenio_boats(*)';
const headers = {
  'apikey': process.env.VITE_SUPABASE_ANON_KEY,
  'Authorization': 'Bearer ' + process.env.VITE_SUPABASE_ANON_KEY
};

fetch(url, { headers })
  .then(res => res.json())
  .then(data => {
      console.log("QUOTES FETCH RESULT:");
      console.log(JSON.stringify(data, null, 2));
  })
  .catch(console.error);
