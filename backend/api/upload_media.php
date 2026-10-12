<?php
require_once __DIR__ . '/../core/api.php';
$me = app_require();
$hid = $me['hotel_id'];
header('Content-Type: application/json; charset=utf-8');

// У каждого отеля своя папка: uploads/h<id>/ (старые фото Ramada остаются в uploads/)
$uploadDir = __DIR__ . '/../../uploads/h' . $hid . '/';

if (!file_exists($uploadDir)) {
    @mkdir($uploadDir, 0755, true);
}

if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_FILES['file'])) {
    $file = $_FILES['file'];

    if ($file['error'] !== UPLOAD_ERR_OK) {
        echo json_encode(['success' => false, 'message' => 'upload_error_' . $file['error']]);
        exit;
    }

    $ext = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
    $allowed = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'mp4', 'mov', 'avi'];

    if (!in_array($ext, $allowed)) {
        echo json_encode(['success' => false, 'message' => 'invalid_file_type']);
        exit;
    }

    $filename = 'task_' . time() . '_' . bin2hex(random_bytes(4)) . '.' . $ext;
    $targetPath = $uploadDir . $filename;

    if (move_uploaded_file($file['tmp_name'], $targetPath)) {
        $fileUrl = '/uploads/h' . $hid . '/' . $filename;
        echo json_encode(['success' => true, 'url' => $fileUrl]);
        exit;
    } else {
        echo json_encode(['success' => false, 'message' => 'move_upload_failed']);
        exit;
    }
}

echo json_encode(['success' => false, 'message' => 'invalid_request']);
?>