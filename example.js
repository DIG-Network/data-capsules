const { helloWorld, init } = require('./index.js')

console.log('🚀 Testing Hello World function...\n')

// Call the hello world function directly
const message = helloWorld()
console.log('✅ Direct call result:', message)

// Call the init function that also calls hello world
console.log('\n🔧 Calling init function...')
const initMessage = init()
console.log('✅ Init call result:', initMessage)

console.log('\n🎉 Hello World test completed successfully!')