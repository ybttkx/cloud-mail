<template>
  <div class="box">
    <div class="container">
      <div class="title">{{$t('profile')}}</div>
      <div class="item">
        <div>{{$t('username')}}</div>
        <div>
          <span v-if="setNameShow" class="edit-name-input">
            <el-input v-model="accountName"  ></el-input>
            <span class="edit-name" @click="setName">
             {{$t('save')}}
            </span>
          </span>
          <span v-else class="user-name">
            <span >{{ userStore.user.name }}</span>
            <span class="edit-name" @click="showSetName">
             {{$t('change')}}
            </span>
          </span>
        </div>
      </div>
      <div class="item">
        <div>{{$t('emailAccount')}}</div>
        <div>{{ userStore.user.email }}</div>
      </div>
      <div class="item">
        <div>{{$t('password')}}</div>
        <div>
          <el-button type="primary" @click="pwdShow = true">{{$t('changePwdBtn')}}</el-button>
        </div>
      </div>
    </div>

    <!-- API Key 管理模块 -->
    <div class="api-key-section">
      <div class="title">{{$t('apiKeyTitle')}}</div>
      <div class="desc" style="color: var(--regular-text-color); margin-top: 8px; font-size: 14px;">
        {{$t('apiKeyDesc')}}
      </div>

      <div class="key-box" style="margin-top: 15px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
        <el-input
          :type="showKey ? 'text' : 'password'"
          v-model="apiKey"
          readonly
          style="width: 320px;"
        >
          <template #append>
            <el-button @click="showKey = !showKey">
              {{ showKey ? $t('hideApiKey') : $t('showApiKey') }}
            </el-button>
          </template>
        </el-input>
        <el-button type="primary" @click="copyKey">{{$t('copyApiKey')}}</el-button>
        <el-button type="warning" plain @click="handleResetApiKey">{{$t('resetApiKeyBtn')}}</el-button>
      </div>

      <div class="curl-example" style="margin-top: 20px;">
        <div style="font-weight: bold; margin-bottom: 8px; font-size: 14px;">API 发信 Curl 调用示例</div>
        <div style="background-color: var(--el-fill-color-dark, #2b2b2b); color: #87e8de; padding: 12px; border-radius: 6px; font-family: monospace; font-size: 13px; white-space: pre-wrap; word-break: break-all;">
curl -X POST https://mail.ybovo.com/api/open/send \
  -H "X-API-Key: {{ apiKey || 'YOUR_API_KEY' }}" \
  -H "Content-Type: application/json" \
  -d '{
    "from": "admin@ybovo.com",
    "to": "recipient@example.com",
    "subject": "测试邮件主题",
    "content": "<p>邮件内容（支持 HTML）</p>"
  }'
        </div>
      </div>
    </div>

    <div class="del-email" v-perm="'my:delete'">
      <div class="title">{{$t('deleteUser')}}</div>
      <div style="color: var(--regular-text-color);">
        {{$t('delAccountMsg')}}
      </div>
      <div>
        <el-button type="primary" @click="deleteConfirm">{{$t('deleteUserBtn')}}</el-button>
      </div>
    </div>
    <el-dialog v-model="pwdShow" :title="$t('changePassword')" width="340">
      <div class="update-pwd">
        <el-input type="password" :placeholder="$t('newPassword')" v-model="form.password" autocomplete="off"/>
        <el-input type="password" :placeholder="$t('confirmPassword')" v-model="form.newPwd" autocomplete="off"/>
        <el-button type="primary" :loading="setPwdLoading" @click="submitPwd">{{$t('save')}}</el-button>
      </div>
    </el-dialog>
  </div>
</template>
<script setup>
import {reactive, ref, onMounted, defineOptions} from 'vue'
import {resetPassword, userDelete, getApiKey, resetApiKey} from "@/request/my.js";
import {useUserStore} from "@/store/user.js";
import router from "@/router/index.js";
import {accountSetName} from "@/request/account.js";
import {useAccountStore} from "@/store/account.js";
import {useI18n} from "vue-i18n";
import { ElMessage, ElMessageBox } from 'element-plus';

const { t } = useI18n()
const accountStore = useAccountStore()
const userStore = useUserStore();
const setPwdLoading = ref(false)
const setNameShow = ref(false)
const accountName = ref(null)

const apiKey = ref('')
const showKey = ref(false)

defineOptions({
  name: 'setting'
})

onMounted(() => {
  fetchApiKey();
});

function fetchApiKey() {
  getApiKey().then(res => {
    // 兼容 axios 拦截器自动解包的情况
    if (res) {
      apiKey.value = typeof res === 'string' ? res : (res.data || res)
    }
  }).catch(() => {})
}

function copyKey() {
  if (!apiKey.value) return;
  navigator.clipboard.writeText(apiKey.value).then(() => {
    ElMessage({
      message: t('copySuccess'),
      type: 'success',
      plain: true,
    })
  });
}

function handleResetApiKey() {
  ElMessageBox.confirm(t('resetApiKeyConfirm'), {
    confirmButtonText: t('confirm'),
    cancelButtonText: t('cancel'),
    type: 'warning'
  }).then(() => {
    resetApiKey().then(res => {
      if (res) {
        apiKey.value = typeof res === 'string' ? res : (res.data || res)
        ElMessage({
          message: t('saveSuccessMsg'),
          type: 'success',
          plain: true,
        })
      }
    })
  })
}

function showSetName() {
  accountName.value = userStore.user.name
  setNameShow.value = true
}

function setName() {

  if (!accountName.value) {
    ElMessage({
      message: t('emptyUserNameMsg'),
      type: 'error',
      plain: true,
    })
    return;
  }

  setNameShow.value = false
  let name = accountName.value

  if (name === userStore.user.name) {
    return
  }

  userStore.user.name = accountName.value

  accountSetName(userStore.user.account.accountId,name).then(() => {
    ElMessage({
      message: t('saveSuccessMsg'),
      type: 'success',
      plain: true,
    })

    accountStore.changeUserAccountName = name

  }).catch(() => {
    userStore.user.name = name
  })
}

const pwdShow = ref(false)
const form = reactive({
  password: '',
  newPwd: '',
})

const deleteConfirm = () => {
  ElMessageBox.confirm(t('delAccountConfirm'), {
    confirmButtonText: t('confirm'),
    cancelButtonText: t('cancel'),
    type: 'warning'
  }).then(() => {
    userDelete().then(() => {
      localStorage.removeItem('token');
      router.replace('/login');
      ElMessage({
        message: t('delSuccessMsg'),
        type: 'success',
        plain: true,
      })
    })
  })
}


function submitPwd() {

  if (!form.password) {
    ElMessage({
      message: t('emptyPwdMsg'),
      type: 'error',
      plain: true,
    })
    return
  }

  if (form.password.length < 6) {
    ElMessage({
      message: t('pwdLengthMsg'),
      type: 'error',
      plain: true,
    })
    return
  }

  if (form.password !== form.newPwd) {
    ElMessage({
      message: t('confirmPwdFailMsg'),
      type: 'error',
      plain: true,
    })
    return
  }

  setPwdLoading.value = true
  resetPassword(form.password).then(() => {
    ElMessage({
      message: t('saveSuccessMsg'),
      type: 'success',
      plain: true,
    })
    pwdShow.value = false
    setPwdLoading.value = false
    form.password = ''
    form.newPwd = ''
  }).catch(() => {
    setPwdLoading.value = false
  })

}

</script>
<style scoped lang="scss">
.box {
  padding: 40px 40px;

  @media (max-width: 767px) {
    padding: 30px 30px;
  }

  .api-key-section {
    margin-bottom: 40px;
  }

  .update-pwd {
    display: flex;
    flex-direction: column;
    gap: 15px;
  }

  .title {
    font-size: 18px;
    font-weight: bold;
  }

  .container {
    font-size: 14px;
    display: grid;
    gap: 20px;
    margin-bottom: 40px;

    .item {
      display: grid;
      grid-template-columns: 50px 1fr;
      gap: 140px;
      position: relative;
      .user-name {
        display: grid;
        grid-template-columns: auto 1fr;
        span:first-child {
          overflow: hidden;
          white-space: nowrap;
          text-overflow: ellipsis;
        }
      }

      .edit-name-input {
        position: absolute;
        bottom: -6px;
        .el-input {
          width: min(200px,calc(100vw - 222px));
        }
      }

      .edit-name {
        color: #4dabff;
        padding-left: 10px;
        cursor: pointer;
      }

      @media (max-width: 767px) {
        gap: 70px;
      }

      div:first-child {
        font-weight: bold;
      }

      div:last-child {
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
      }
    }
  }

  .del-email {
    font-size: 14px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
}
</style>
