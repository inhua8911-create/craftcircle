// Must be the FIRST import of any test file that needs Razorpay mode: ES imports run in order,
// so this executes before config/env.ts is first evaluated.
process.env.PAYMENT_MODE = 'razorpay';
process.env.RAZORPAY_KEY_ID = 'rzp_test_dummy';
process.env.RAZORPAY_KEY_SECRET = 'key-secret-for-tests';
process.env.RAZORPAY_WEBHOOK_SECRET = 'webhook-secret-for-tests';
