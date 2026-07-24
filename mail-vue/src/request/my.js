import http from '@/axios/index.js';

export function loginUserInfo() {
    return http.get('/my/loginUserInfo')
}

export function resetPassword(password) {
    return http.put('/my/resetPassword', {password})
}

export function userDelete() {
    return http.delete('/my/delete')
}

export function getApiKey() {
    return http.get('/my/api-key')
}

export function resetApiKey() {
    return http.post('/my/api-key/reset')
}


