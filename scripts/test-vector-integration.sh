#!/bin/bash
# Test script for Vector telemetry integration
# Sends test events to Vector and verifies they appear in ClickHouse

set -e

VECTOR_URL="${VECTOR_URL:-http://localhost:8080/v1/events}"
CLICKHOUSE_URL="${CLICKHOUSE_URL:-http://localhost:8123}"

echo "======================================"
echo "EasyClaw Vector Integration Test"
echo "======================================"
echo ""

# Check if Vector is running
echo "1. Checking Vector health..."
if curl -f -s "${VECTOR_URL/\/v1\/events/\/health}" > /dev/null 2>&1; then
  echo "   ✓ Vector is healthy"
else
  echo "   ✗ Vector is not running or not healthy"
  echo "   Please start services: cd server && docker compose up -d clickhouse vector"
  exit 1
fi

# Check if ClickHouse is running
echo "2. Checking ClickHouse connectivity..."
if curl -f -s "${CLICKHOUSE_URL}/ping" > /dev/null 2>&1; then
  echo "   ✓ ClickHouse is healthy"
else
  echo "   ✗ ClickHouse is not running"
  echo "   Please start services: cd server && docker compose up -d clickhouse"
  exit 1
fi

# Send test events
echo "3. Sending test events to Vector..."
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
SESSION_ID="test-session-$(date +%s)"

curl -X POST "${VECTOR_URL}" \
  -H 'Content-Type: application/json' \
  -s -o /dev/null -w "   HTTP Status: %{http_code}\n" \
  -d "{
    \"events\": [
      {
        \"eventType\": \"test.vector.integration\",
        \"timestamp\": \"${TIMESTAMP}\",
        \"sessionId\": \"${SESSION_ID}\",
        \"userId\": \"test-user-123\",
        \"version\": \"0.1.0\",
        \"platform\": \"darwin\",
        \"metadata\": {\"test\": true, \"script\": \"test-vector-integration.sh\"}
      },
      {
        \"eventType\": \"app.started\",
        \"timestamp\": \"${TIMESTAMP}\",
        \"sessionId\": \"${SESSION_ID}\",
        \"userId\": \"test-user-123\",
        \"version\": \"0.1.0\",
        \"platform\": \"darwin\",
        \"metadata\": {}
      }
    ]
  }"

# Wait for Vector to process and send to ClickHouse
echo "4. Waiting for events to be processed (5 seconds)..."
sleep 5

# Query ClickHouse for our test events
echo "5. Querying ClickHouse for test events..."
RESULT=$(curl -s "${CLICKHOUSE_URL}/?query=SELECT+count(*)+FROM+easyclaw.telemetry_events+WHERE+sessionId='${SESSION_ID}'+FORMAT+JSONEachRow")
COUNT=$(echo "$RESULT" | grep -o '"count()":"[0-9]*"' | grep -o '[0-9]*' || echo "0")

if [ "$COUNT" -ge 2 ]; then
  echo "   ✓ Found $COUNT events in ClickHouse"
else
  echo "   ✗ Expected 2 events, found $COUNT"
  echo "   Debugging information:"
  echo ""
  echo "   Recent ClickHouse events:"
  curl -s "${CLICKHOUSE_URL}/?query=SELECT+*+FROM+easyclaw.telemetry_events+ORDER+BY+timestamp+DESC+LIMIT+5+FORMAT+JSONEachRow" | head -5
  exit 1
fi

# Display the test events
echo "6. Displaying test events:"
curl -s "${CLICKHOUSE_URL}/?query=SELECT+eventType,timestamp,sessionId,version,platform,metadata,received_at+FROM+easyclaw.telemetry_events+WHERE+sessionId='${SESSION_ID}'+FORMAT+JSONEachRow" | while read -r line; do
  echo "   $line"
done

echo ""
echo "======================================"
echo "✓ All tests passed!"
echo "======================================"
echo ""
echo "Summary:"
echo "  - Vector is receiving HTTP events"
echo "  - Events are being parsed and transformed"
echo "  - ClickHouse is storing events successfully"
echo "  - End-to-end data pipeline is working"
echo ""
