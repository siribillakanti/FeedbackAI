const { port, db } = require('./config/env');
const app = require('./app');

app.listen(port, () => {
  console.log(`FeedbackAI API listening on http://localhost:${port} (database ${db.database})`);
});
