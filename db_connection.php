<?php
$host = "localhost";
$dbname = "coffee_overflow";
$username = "root"; // Default for XAMPP/MAMP
$password = "";     // Default is empty for XAMPP, "root" for MAMP

try {
    $pdo = new PDO("mysql:host=$host;dbname=$dbname;charset=utf8", $username, $password);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
} catch (PDOException $e) {
    die("Database connection failed: " . $e->getMessage());
}
?>