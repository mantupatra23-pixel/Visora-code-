// config/db.js
const mongoose = require('mongoose');
require('dotenv').config();

const connectDB = async () => {
    try {
        // Mongoose 6+ mein options ki zaroorat nahi hoti, par safety ke liye strictQuery set kar rahe hain
        mongoose.set('strictQuery', false); 
        const conn = await mongoose.connect(process.env.MONGO_URI);
        console.log(`[Mantu DB] MongoDB Connected: ${conn.connection.host} 🚀`);
    } catch (error) {
        console.error(`[Mantu DB Error] ❌ ${error.message}`);
        process.exit(1); // Error aane par server rok do
    }
};

module.exports = connectDB;
