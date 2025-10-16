const cors = require('cors');
module.exports = cors({
  origin: ['https://7goldencowries.com', 'https://www.7goldencowries.com'],
  credentials: true,
});
