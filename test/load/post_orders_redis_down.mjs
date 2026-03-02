import http from 'k6/http';
import { check } from 'k6';
import { uuidv4 } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

export const options = {
  vus: 20,            // 20 virtual users
  duration: '15s',    // chạy 15 giây
};

const BASE_URL = 'http://localhost:3000';
const TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI2ZjZhNGE4YS0wMDU5LTQ0ZWYtYmI5Ny01ODI5MzAzYjAxMzAiLCJyb2xlIjoiVVNFUiIsImlhdCI6MTc3MTU3MDM4MSwiZXhwIjoxNzcxNTcxMjgxfQ.CipruzCjjxnTII-DTiKYX5N1E6eaPPXLRFQ7D_PLXKU';

export default function () {
  const payload = JSON.stringify({
    items: [
      {
        productId: 'f8f81941-bf95-455f-b508-40036ecd8789',
        quantity: 1,
      },
    ],
  });

  const params = {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'content-type': 'application/json',
      'Idempotency-Key': uuidv4(),   // QUAN TRỌNG
    },
  };

  const res = http.post(`${BASE_URL}/orders`, payload, params);

  check(res, {
    'status is 201': (r) => r.status === 201,
  });
}