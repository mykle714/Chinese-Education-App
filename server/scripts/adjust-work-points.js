#!/usr/bin/env node

/**
 * Work Points Adjustment Script
 * 
 * Usage:
 *   node adjust-work-points.js [points]
 * 
 * Examples:
 *   node adjust-work-points.js 10    (add 10 minutes of study time)
 *   node adjust-work-points.js -50   (subtract 50 minutes of study time)
 * 
 * This script adjusts work points for user: 354f37b7-22bf-4cda-a969-1f2536c714a3
 */

import pg from 'pg';
const { Pool } = pg;

// Database configuration
const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'cow_db',
    user: process.env.DB_USER || 'cow_user',
    password: process.env.DB_PASSWORD || 'cow_password_local'
});

const USER_ID = '354f37b7-22bf-4cda-a969-1f2536c714a3';

async function adjustWorkPoints() {
    const pointsToAdd = parseInt(process.argv[2]);
    
    if (isNaN(pointsToAdd)) {
        console.error('❌ Error: Please provide a valid number');
        console.error('Usage: node adjust-work-points.js [points]');
        console.error('Examples:');
        console.error('  node adjust-work-points.js 10    (add 10 minutes)');
        console.error('  node adjust-work-points.js -50   (subtract 50 minutes)');
        process.exit(1);
    }

    const today = new Date().toISOString().split('T')[0];
    
    try {
        console.log(`📊 Adjusting work points for user ${USER_ID}`);
        console.log(`📅 Date: ${today}`);
        console.log(`${pointsToAdd >= 0 ? '➕' : '➖'} Points to ${pointsToAdd >= 0 ? 'add' : 'subtract'}: ${Math.abs(pointsToAdd)}`);
        console.log('');

        // Start transaction
        await pool.query('BEGIN');

        // Get current points for today
        const currentResult = await pool.query(
            `SELECT workpoints FROM user_work_points 
             WHERE userid = $1 AND date = $2`,
            [USER_ID, today]
        );

        let oldPoints = 0;
        let newPoints = pointsToAdd;

        if (currentResult.rows.length > 0) {
            oldPoints = currentResult.rows[0].workpoints;
            newPoints = oldPoints + pointsToAdd;
        }

        // Ensure points don't go negative
        if (newPoints < 0) {
            console.warn(`⚠️  Warning: Resulting points would be negative (${newPoints})`);
            console.warn(`   Setting to 0 instead`);
            newPoints = 0;
        }

        // Upsert user_work_points for today
        await pool.query(
            `INSERT INTO user_work_points (userid, date, workpoints)
             VALUES ($1, $2, $3)
             ON CONFLICT (userid, date)
             DO UPDATE SET workpoints = $3`,
            [USER_ID, today, newPoints]
        );

        // Update total work points in users table
        await pool.query(
            `UPDATE users 
             SET totalworkpoints = COALESCE(totalworkpoints, 0) + $1
             WHERE id = $2`,
            [pointsToAdd, USER_ID]
        );

        // Get updated total
        const totalResult = await pool.query(
            `SELECT totalworkpoints FROM users WHERE id = $1`,
            [USER_ID]
        );
        const totalPoints = totalResult.rows[0]?.totalworkpoints || 0;

        // Commit transaction
        await pool.query('COMMIT');

        console.log('✅ Success!');
        console.log('');
        console.log('📈 Results:');
        console.log(`   Today's points: ${oldPoints} → ${newPoints} (${pointsToAdd >= 0 ? '+' : ''}${pointsToAdd})`);
        console.log(`   Total lifetime points: ${totalPoints}`);
        console.log(`   Study time today: ${newPoints} minutes (${(newPoints / 60).toFixed(1)} hours)`);
        console.log(`   Total study time: ${totalPoints} minutes (${(totalPoints / 60).toFixed(1)} hours)`);

    } catch (error) {
        await pool.query('ROLLBACK');
        console.error('❌ Error adjusting work points:', error.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

adjustWorkPoints();
