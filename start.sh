#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=== LearnOCW ==="
echo ""

# Check Python
if ! command -v python3 &>/dev/null && ! command -v python &>/dev/null; then
  echo "ERROR: Python not found. Please install Python 3.10+."
  exit 1
fi

PYTHON=$(command -v python3 || command -v python)

# Create virtual environment if needed
if [ ! -d "venv" ]; then
  echo "Creating Python virtual environment..."
  $PYTHON -m venv venv
fi

# Activate venv
if [ -f "venv/Scripts/activate" ]; then
  source venv/Scripts/activate  # Windows Git Bash
elif [ -f "venv/bin/activate" ]; then
  source venv/bin/activate
fi

# Install Python deps
echo "Installing Python dependencies..."
pip install -q -r requirements.txt

# Check Node
if ! command -v node &>/dev/null; then
  echo "ERROR: Node.js not found. Please install Node.js 18+."
  exit 1
fi

# Install frontend deps
echo "Installing frontend dependencies..."
cd frontend
if [ ! -d "node_modules" ]; then
  npm install --legacy-peer-deps
fi
cd ..

echo ""
echo "Starting LearnOCW..."
echo "  Backend:  http://localhost:8000"
echo "  Frontend: http://localhost:5173"
echo ""
echo "Press Ctrl+C to stop."
echo ""

# Launch backend
cd backend
python main.py &
BACKEND_PID=$!
cd ..

# Wait for backend to start
sleep 2

# Launch frontend
cd frontend
npm run dev &
FRONTEND_PID=$!
cd ..

# Trap Ctrl+C
cleanup() {
  echo ""
  echo "Stopping servers..."
  kill $BACKEND_PID 2>/dev/null || true
  kill $FRONTEND_PID 2>/dev/null || true
  exit 0
}
trap cleanup INT TERM

wait
